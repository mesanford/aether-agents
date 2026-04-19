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

async function startServer() {
  const app = express();
  const PORT = Number.parseInt(process.env.PORT || "3001", 10);

  // 1. GLOBAL MIDDLEWARE
  app.use(express.json({ limit: "5mb" }));

  // 2. READINESS GUARD
  // Returns 503 for non-essential /api/* routes until DB bootstrap completes.
  let isReady = false;
  app.use((req, res, next) => {
    // Always allow non-API requests (static assets, etc.)
    if (!req.path.startsWith("/api")) {
      return next();
    }

    // Allow essential routes to bypass readiness
    const isEssential = (
      req.method === "DELETE" || // Allow workspace deletions
      req.path === "/api/auth/me" ||
      req.path.includes("/status") ||
      req.path.includes("/members") ||
      // LinkedIn OAuth: connect initiation and callback must be reachable before
      // bootstrap completes, since the user can trigger them immediately on page
      // load and LinkedIn's redirect can arrive at any point.
      req.path.includes("/integrations/linkedin/connect") ||
      req.path === "/api/auth/linkedin/callback"
    );

    if (!isReady && !isEssential) {
      res.status(503).json({ error: "Server is starting up, please retry shortly." });
      return;
    }
    next();
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
  let seedWorkspace: ((workspaceId: string | number | bigint) => Promise<void>) | undefined;

  registerAuthRoutes({
    app,
    db,
    jwtSecret: JWT_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authRateLimiter,
    seedWorkspace: async (id) => { if (seedWorkspace) await seedWorkspace(id); },
  });

  function buildLiveDataSection(liveContext?: LiveContext): string {
    if (!liveContext) return "";
    const parts: string[] = [];
    if (liveContext.emails?.length) {
      parts.push(`LIVE GMAIL DATA (${new Date().toLocaleDateString()}):\n` + liveContext.emails.map((e) => `- From: ${e.from}\n  Subject: ${e.subject}`).join("\n"));
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
    seedWorkspace: async (id) => { if (seedWorkspace) await seedWorkspace(id); },
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

  // 5. STATIC ASSETS & VITE
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
    seedWorkspace = bootstrapResult.seedWorkspace;
    
    migrateBase64ToGCS(db).catch(err => console.error("GCS migration error:", err));
    startTaskEngine({ db, pollIntervalMs: 60000, aiClient, googleClientId: process.env.GOOGLE_CLIENT_ID, googleClientSecret: process.env.GOOGLE_CLIENT_SECRET });
    
    // Mark as ready ONLY after critical DB work is done
    isReady = true;
    console.log(`Server fully ready on port ${PORT}`);
  } catch (err: any) {
    // Log the full error so Cloud Logging captures the real cause
    console.error("CRITICAL: Bootstrap failure — server starting in degraded mode:", err?.message || err);
    console.error(err?.stack || "(no stack)");
    // Set ready anyway: all tables are created with IF NOT EXISTS, so the DB
    // is in a consistent-enough state to serve requests. Keeping isReady=false
    // permanently would make the entire app return 503 forever, hiding the real
    // error and blocking users. Individual routes will 500 on missing schema,
    // which is far more debuggable than a global lockout.
    isReady = true;
    console.warn("Server marked ready in degraded mode. Check logs for bootstrap errors above.");
  }

  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });
}

startServer().catch((err) => {
  console.error("FATAL: Server crash:", err);
  process.exit(1);
});
