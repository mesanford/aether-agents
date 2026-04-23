import express from "express";
import type { AuthenticatedRequest } from "../types.ts";
import type { PostgresShim } from "../db.ts";
import { sendPushToWorkspace } from "../notificationSender.ts";

type DatabaseLike = PostgresShim;

type RegisterNotificationRoutesArgs = {
  app: express.Application;
  db: DatabaseLike;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
};

export function registerNotificationRoutes({
  app,
  db,
  requireAuth,
  requireWorkspaceAccess,
}: RegisterNotificationRoutesArgs) {
  // Return the VAPID public key — safe to expose publicly
  app.get("/api/notifications/vapid-public-key", (_req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return res.status(500).json({ error: "VAPID not configured" });
    }
    res.json({ publicKey });
  });

  // Upsert a push subscription for the authenticated user
  app.post(
    "/api/workspaces/:workspaceId/notifications/subscribe",
    requireAuth,
    requireWorkspaceAccess,
    async (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const userId = (req as AuthenticatedRequest).userId;
      const { endpoint, keys } = req.body as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      if (
        !endpoint ||
        typeof endpoint !== "string" ||
        !endpoint.startsWith("https://") ||
        !keys?.p256dh ||
        !keys?.auth
      ) {
        return res.status(400).json({ error: "Invalid push subscription payload" });
      }

      const userAgent = req.headers["user-agent"]?.slice(0, 255) ?? null;

      try {
        await db.prepare(`
          INSERT INTO push_subscriptions (workspace_id, user_id, endpoint, p256dh, auth, user_agent)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (endpoint) DO UPDATE SET
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            workspace_id = EXCLUDED.workspace_id,
            user_id = EXCLUDED.user_id
        `).run(workspaceId, userId, endpoint, keys.p256dh, keys.auth, userAgent);

        res.json({ ok: true });
      } catch (err: any) {
        console.error("[Notifications] Subscribe error:", err);
        res.status(500).json({ error: "Failed to save subscription" });
      }
    }
  );

  // Remove a push subscription
  app.delete(
    "/api/workspaces/:workspaceId/notifications/subscribe",
    requireAuth,
    requireWorkspaceAccess,
    async (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const { endpoint } = req.body as { endpoint?: string };

      if (!endpoint || typeof endpoint !== "string") {
        return res.status(400).json({ error: "Missing endpoint" });
      }

      try {
        await db.prepare(
          "DELETE FROM push_subscriptions WHERE endpoint = ? AND workspace_id = ?"
        ).run(endpoint, workspaceId);
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[Notifications] Unsubscribe error:", err);
        res.status(500).json({ error: "Failed to remove subscription" });
      }
    }
  );

  // Send a test push notification to all subscribers in the workspace
  app.post(
    "/api/workspaces/:workspaceId/notifications/test",
    requireAuth,
    requireWorkspaceAccess,
    async (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const title = (req.body?.title as string) || "Test Notification";
      const message = (req.body?.message as string) || "Your agents are ready to notify you!";

      try {
        const result = await sendPushToWorkspace(workspaceId, { title, message });
        if (result.sent === 0 && result.failed === 0) {
          return res.status(404).json({
            error: "No push subscriptions found for this workspace. Enable notifications in your browser first."
          });
        }
        res.json(result);
      } catch (err: any) {
        console.error("[Notifications] Test send error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
}
