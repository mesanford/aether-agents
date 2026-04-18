import "dotenv/config";
import { config } from "dotenv";

// Load .env.local (takes precedence over .env)
config({ path: ".env.local", override: true });

import express from "express";
import db from "./src/server/db.ts";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { createSecurityTools } from "./src/server/security.ts";
import { createAuditLogger } from "./src/server/audit.ts";
import {
  getAllowedAgentUpdate,
  getAllowedMessageCreate,
  getAllowedTaskCreate,
  getAllowedTaskUpdate,
  isNonEmptyString,
} from "./src/server/validators.ts";
import type { AuthenticatedRequest, ConnectedServices, LiveContext } from "./src/server/types.ts";
import { registerAuthRoutes } from "./src/server/routes/authRoutes.ts";
import { registerAiRoutes } from "./src/server/routes/aiRoutes.ts";
import { registerWorkspaceRoutes } from "./src/server/routes/workspaceRoutes.ts";
import { registerIntegrationsRoutes } from "./src/server/routes/integrationsRoutes.ts";
import { registerGoogleDriveRoutes } from "./src/server/routes/googleDriveRoutes.ts";
import { registerApprovalRoutes } from "./src/server/routes/approvalRoutes.ts";
import { bootstrapDatabase } from "./src/server/dbBootstrap.ts";
import { startTaskEngine } from "./src/server/taskEngine.ts";
import { startSequenceDaemon } from "./src/server/sequenceDaemon.ts";
import { migrateBase64ToGCS } from "./src/server/gcpStorage.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

// NOTE: Do NOT call process.exit() here at module level — that would kill the
// container before app.listen() opens the port, triggering Cloud Run timeout.
if (!process.env.JWT_SECRET) {
  if (!isProduction) {
    console.warn("JWT_SECRET environment variable is not set. Using a development-only fallback secret.");
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "development-only-jwt-secret";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let aiClient: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || "3001", 10);

  // Register body parser FIRST — must be before app.listen() so all routes
  // (including those registered during bootstrap) have JSON parsing available.
  app.use(express.json({ limit: "5mb" }));

  // Register readiness guard BEFORE app.listen so it's in the middleware chain.
  // Returns 503 for /api/* routes until DB bootstrap completes.
  let isReady = false;
  let seedWorkspace: ((workspaceId: string | number | bigint) => Promise<void>) | undefined;

  app.use((req, res, next) => {
    if (!isReady && req.path.startsWith("/api") && req.method !== "DELETE") {
      res.status(503).json({ error: "Server is starting up, please retry shortly." });
      return;
    }
    next();
  });

  // Warn about missing JWT_SECRET but do NOT exit — closing the server here
  // would kill the port before Cloud Run considers the revision ready.
  if (isProduction && !process.env.JWT_SECRET) {
    console.error("WARNING: JWT_SECRET environment variable is not set in production. Auth will be insecure.");
  }

  // Start listening IMMEDIATELY so Cloud Run health checks pass while
  // async bootstrap (DB migrations, GCS migration) completes in the background.
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT} (bootstrapping...)`);
  });

  // Gracefully handle listen errors (e.g. EADDRINUSE) so the process exits
  // with a clear message rather than hanging.
  server.on("error", (err) => {
    console.error("FATAL: Failed to bind to port:", err);
    process.exit(1);
  });

  try {
    const bootstrapResult = await bootstrapDatabase(db);
    seedWorkspace = bootstrapResult.seedWorkspace;
  } catch (err) {
    console.error("Database bootstrap failed:", err);
    // Still mark ready so the server stays up (avoids Cloud Run restart loop)
  }

  // Kick off migration of any legacy SQLite base64 strings to GCS (non-blocking)
  migrateBase64ToGCS(db).catch((err) =>
    console.error("GCS migration error (non-fatal):", err)
  );

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  const {
    getUserIdFromRequest,
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole,
    createRateLimiter,
  } = createSecurityTools(db, JWT_SECRET);
  const writeAuditLog = createAuditLogger(db);

  const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyPrefix: "auth" });
  const aiRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, keyPrefix: "ai" });

  registerAuthRoutes({
    app,
    db,
    jwtSecret: JWT_SECRET,
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    authRateLimiter,
    seedWorkspace,
  });

  function buildLiveDataSection(liveContext?: LiveContext): string {
    if (!liveContext) return "";

    const parts: string[] = [];
    if (liveContext.emails?.length) {
      parts.push(
        `LIVE GMAIL DATA (${new Date().toLocaleDateString()} - use this as ground truth):\n` +
        liveContext.emails
          .map((e) => `- From: ${e.from}\n  Subject: ${e.subject}\n  Date: ${e.date}\n  Preview: ${e.snippet}`)
          .join("\n")
      );
    }
    if (liveContext.events?.length) {
      parts.push(
        `LIVE CALENDAR DATA (${new Date().toLocaleDateString()} - use this as ground truth):\n` +
        liveContext.events
          .map((e) => `- ${e.summary} - ${new Date(e.start).toLocaleString()} to ${new Date(e.end).toLocaleTimeString()}${e.location ? ` @ ${e.location}` : ""}${e.attendees?.length ? ` (with: ${e.attendees.join(", ")})` : ""}`)
          .join("\n")
      );
    }
    if (liveContext.files?.length) {
      parts.push(
        "LIVE DRIVE DATA (recently modified files):\n" +
        liveContext.files
          .slice(0, 10)
          .map((f) => `- [${f.type.toUpperCase()}] ${f.name} - modified ${new Date(f.modifiedTime).toLocaleDateString()}`)
          .join("\n")
      );
    }
    if (liveContext.analyticsRows?.length) {
      parts.push(
        "LIVE GA4 DATA (recent top rows):\n" +
        liveContext.analyticsRows
          .slice(0, 10)
          .map((r) => `- Date: ${r.date} | Sessions: ${r.sessions} | Users: ${r.users} | Page Views: ${r.pageViews}`)
          .join("\n")
      );
    }
    if (liveContext.searchConsoleRows?.length) {
      parts.push(
        "LIVE SEARCH CONSOLE DATA (top queries):\n" +
        liveContext.searchConsoleRows
          .slice(0, 10)
          .map((r) => `- Query: ${r.query} | Clicks: ${r.clicks} | Impressions: ${r.impressions} | CTR: ${(r.ctr * 100).toFixed(2)}% | Position: ${r.position.toFixed(2)}`)
          .join("\n")
      );
    }

    if (parts.length === 0) return "";
    return `\n\n--- LIVE CONNECTED DATA (real, accurate - use this to answer the user's question) ---\n${parts.join("\n\n")}\n--- END LIVE DATA ---`;
  }

  function buildDataAccessSection(connectedServices?: ConnectedServices): string {
    const hasGmail = connectedServices?.gmail;
    const hasCalendar = connectedServices?.calendar;
    const hasDrive = connectedServices?.drive;
    const hasSlack = connectedServices?.slack;
    const hasTeams = connectedServices?.teams;
    const hasNotion = connectedServices?.notion;
    const hasLinkedIn = connectedServices?.linkedin;
    const hasBuffer = connectedServices?.buffer;
    const hasAnalytics = connectedServices?.analytics;
    const hasSearchConsole = connectedServices?.searchConsole;

    if (hasGmail || hasCalendar || hasDrive || hasSlack || hasTeams || hasNotion || hasLinkedIn || hasBuffer || hasAnalytics || hasSearchConsole) {
      const serviceList = [
        hasGmail ? "Gmail (inbox, emails)" : null,
        hasCalendar ? "Google Calendar (events, schedule)" : null,
        hasDrive ? "Google Drive, Docs, and Slides (files)" : null,
        hasSlack ? "Slack (messaging destination)" : null,
        hasTeams ? "Microsoft Teams (messaging destination)" : null,
        hasNotion ? "Notion (knowledge workspace destination)" : null,
        hasLinkedIn ? "LinkedIn (publishing destination)" : null,
        hasBuffer ? "Buffer (social scheduling destination)" : null,
        hasAnalytics ? "Google Analytics 4 (sessions, users, page performance)" : null,
        hasSearchConsole ? "Google Search Console (queries, clicks, impressions, rankings)" : null,
      ].filter(Boolean).join(", ");

      return `CONNECTED SERVICES: You have live access to the following services for this user: ${serviceList}.
      - When the user asks about emails, inbox, schedule, calendar, documents, files, SEO, or analytics, real data will be injected into this prompt under the LIVE CONNECTED DATA section below.
      - If that section contains data, use it to answer accurately and specifically. Do NOT say you lack access.
      - If the LIVE CONNECTED DATA section is absent or empty for a particular service, it means there is no data available right now - report that clearly.
      - CRITICAL: Do NOT invent, guess, or fabricate any email subjects, sender names, event titles, file names, analytics values, or search query data.
      - Never present fabricated data as real.`;
    }

    return `DATA ACCESS: You do NOT have live access to any external systems (Gmail, Google Calendar, Drive, Search Console, GA4, Slack, Teams, Notion, etc.).
    - If asked about real-time data, do NOT make it up. Tell the user you don't have access and suggest connecting via Settings -> Integrations.
    - Never present fabricated data as real.`;
  }

  registerWorkspaceRoutes({
    app,
    db,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
    requireWorkspaceRole,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog,
    seedWorkspace,
  });

  registerAiRoutes({
    app,
    db,
    aiClient,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
    aiRateLimiter,
    isNonEmptyString,
    buildDataAccessSection,
    buildLiveDataSection,
  });

  registerIntegrationsRoutes({
    app,
    db,
    googleClientId: GOOGLE_CLIENT_ID,
    googleClientSecret: GOOGLE_CLIENT_SECRET,
    getUserIdFromRequest,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
    requireWorkspaceRole,
  });

  registerGoogleDriveRoutes({
    app,
    db,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
  });

  registerApprovalRoutes({
    app,
    db,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
  });

  // Vite middleware for development (dynamic import keeps vite out of production bundle)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  startTaskEngine({ db, pollIntervalMs: 60000, aiClient, googleClientId: GOOGLE_CLIENT_ID, googleClientSecret: GOOGLE_CLIENT_SECRET });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled server error:", err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  });

  // Mark server as fully ready
  isReady = true;
  console.log(`Server fully ready on http://localhost:${PORT}`);
}

startServer().catch((err) => {
  console.error("FATAL: startServer() threw an unhandled error:", err);
  process.exit(1);
});
