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
import { registerNotificationRoutes } from "./src/server/routes/notificationRoutes.ts";
import { bootstrapDatabase } from "./src/server/dbBootstrap.ts";
import { startTaskEngine } from "./src/server/taskEngine.ts";
import { startSequenceDaemon } from "./src/server/sequenceDaemon.ts";

import { migrateBase64ToGCS } from "./src/server/gcpStorage.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

const JWT_SECRET = process.env.JWT_SECRET || "development-only-jwt-secret";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let aiClient: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || "3001", 10);

  // 1. GLOBAL MIDDLEWARE
  app.use(express.json({ limit: "20mb" }));

  // 2. LIVENESS ENDPOINT
  // Tracks bootstrap state for observability — does NOT block any traffic.
  // Blocking requests during bootstrap caused 503 storms on every cold start;
  // individual routes will 500 on DB errors if something is truly wrong.
  let bootstrapDone = false;
  let bootstrapError: string | null = null;
  app.get("/api/health", (_req, res) => {
    res.json({
      status: bootstrapDone ? (bootstrapError ? "degraded" : "ok") : "starting",
      bootstrapError: bootstrapError ?? undefined,
    });
  });

  // 3. SECURITY & LOGGING TOOLS
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

  // 4. ROUTE REGISTRATION
  let _seedWorkspaceFn: ((workspaceId: string | number | bigint) => Promise<void>) | undefined;

  const seedWorkspaceWrapper = async (id: string | number | bigint) => {
    // If bootstrap hasn't finished yet, wait with retries
    if (!_seedWorkspaceFn) {
      console.warn(`[Server] seedWorkspace called before bootstrap finished for WS ${id}. Waiting...`);
      for (let attempt = 0; attempt < 10 && !_seedWorkspaceFn; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    if (_seedWorkspaceFn) {
      console.log(`[Server] Seeding workspace ${id}...`);
      await _seedWorkspaceFn(id);
      console.log(`[Server] Workspace ${id} seeded successfully.`);
    } else {
      console.error(`[Server] FAILED to seed workspace ${id}: bootstrap never completed. New workspace will have no agents or tasks.`);
    }
  };

  registerAuthRoutes({
    app,
    db,
    jwtSecret: JWT_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authRateLimiter,
    seedWorkspace: seedWorkspaceWrapper,
  });

  function buildLiveDataSection(liveContext?: LiveContext): string {
    if (!liveContext) return "";
    const parts: string[] = [];
    if (liveContext.emails?.length) {
      parts.push(`LIVE GMAIL DATA (${new Date().toLocaleDateString()}):\n` + liveContext.emails.map((e) => {
        const lines = [`- From: ${e.from}`, `  Subject: ${e.subject}`];
        if ((e as any).date) lines.push(`  Date: ${(e as any).date}`);
        if ((e as any).snippet) lines.push(`  Preview: ${(e as any).snippet}`);
        return lines.join('\n');
      }).join("\n"));
    }
    if (liveContext.events?.length) {
      parts.push(`LIVE CALENDAR DATA (${new Date().toLocaleDateString()}):\n` + liveContext.events.map((e) => `- ${e.summary} (${new Date(e.start).toLocaleString()})`).join("\n"));
    }
    if (parts.length === 0) return "";
    return `\n\n--- LIVE CONNECTED DATA ---\n${parts.join("\n\n")}\n--- END LIVE DATA ---`;
  }

  function buildDataAccessSection(connectedServices?: ConnectedServices): string {
    const services = Object.entries(connectedServices || {})
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name)
      .join(", ");
    if (services) return `CONNECTED SERVICES: You have access to: ${services}. Real data is injected below.`;
    return `DATA ACCESS: You do NOT have live access to external systems. Recommend connecting via Settings.`;
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
    seedWorkspace: seedWorkspaceWrapper,
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
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    linkedinClientId: process.env.LINKEDIN_CLIENT_ID,
    linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET,
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

  registerNotificationRoutes({
    app,
    db,
    requireAuth: requireAuth as express.RequestHandler,
    requireWorkspaceAccess: requireWorkspaceAccess as express.RequestHandler,
  });

  // 5. MANIFEST — served by express.static (production) or Vite dev server (development).
  // No custom route needed; the previous custom handler blocked the static middleware.

  // 6. STATIC ASSETS & VITE
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.use(express.static(path.join(__dirname, "public")));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // 6. START LISTENING
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });

  server.on("error", (err) => {
    console.error("FATAL: Failed to bind to port:", err);
    process.exit(1);
  });

  // 7. BACKGROUND BOOTSTRAP (Non-blocking for the listener)
  try {
    const bootstrapResult = await bootstrapDatabase(db);
    _seedWorkspaceFn = bootstrapResult.seedWorkspace;
    
    migrateBase64ToGCS(db).catch(err => console.error("GCS migration error:", err));
    
    bootstrapDone = true;
    console.log(`Server fully ready on port ${PORT}`);
  } catch (err: any) {
    // Log the full error so Cloud Logging captures the real cause
    bootstrapError = err?.message || String(err);
    console.error("CRITICAL: Bootstrap failure — server starting in degraded mode:", bootstrapError);
    console.error(err?.stack || "(no stack)");
    // Do NOT crash or block: tables use IF NOT EXISTS so the DB is in a
    // consistent-enough state. Individual routes will surface their own errors.
    bootstrapDone = true;
    console.warn("Server running in degraded mode. Check /api/health for details.");
  }

  // 8. BACKGROUND JOBS — Always start regardless of bootstrap success.
  // The task engine and sequence daemon query for work independently;
  // they gracefully handle empty tables or missing data.
  startTaskEngine({ db, pollIntervalMs: 60000, aiClient, googleClientId: process.env.GOOGLE_CLIENT_ID, googleClientSecret: process.env.GOOGLE_CLIENT_SECRET });
  startSequenceDaemon(db);

  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    if (res.headersSent) return;
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: "Request body too large. Please use a smaller image." });
    }
    res.status(500).json({ error: "Internal server error" });
  });
}

startServer().catch((err) => {
  console.error("FATAL: Server crash:", err);
  process.exit(1);
});
