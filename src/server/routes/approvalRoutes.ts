import express from "express";
import type { AuthenticatedRequest } from "../types.ts";
import {
  createLinkedInPost,
  createBufferUpdate,
  fetchBufferProfiles,
} from "../socialPublishing.ts";

type DatabaseLike = {
  prepare: (sql: string) => {
    all: (...args: unknown[]) => any[];
    get: (...args: unknown[]) => any;
    run: (...args: unknown[]) => { changes?: number; lastInsertRowid?: number | bigint };
  };
};

type RegisterApprovalRoutesArgs = {
  app: express.Application;
  db: DatabaseLike;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
};

type ApprovalPayload = {
  text?: string;
  link?: string;
  imageUrl?: string;
  title?: string;
  description?: string;
  profileId?: string;
  authorUrn?: string;
  accessToken?: string;
};

function writeApprovalAuditLog(
  db: DatabaseLike,
  workspaceId: number,
  action: string,
  details: Record<string, unknown>,
) {
  try {
    db.prepare(
      "INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES (?, ?, ?, ?, ?)",
    ).run(workspaceId, null, action, "approvals", JSON.stringify(details));
  } catch {
    // best-effort
  }
}

async function dispatchApprovedAction(
  db: DatabaseLike,
  workspaceId: number,
  actionType: string,
  rawPayload: string,
): Promise<void> {
  let payload: ApprovalPayload;
  try {
    payload = JSON.parse(rawPayload) as ApprovalPayload;
  } catch {
    throw new Error("Invalid approval payload JSON");
  }

  if (!payload.text) throw new Error("Payload missing required text field");

  if (actionType === "linkedin_post") {
    const linkedin = db
      .prepare("SELECT access_token, author_urn FROM linkedin_connections WHERE workspace_id = ?")
      .get(workspaceId) as { access_token: string; author_urn: string } | undefined;
    if (!linkedin) throw new Error("LinkedIn not connected");
    await createLinkedInPost(linkedin.access_token, linkedin.author_urn, payload.text, {
      url: payload.link || undefined,
      imageUrl: payload.imageUrl || undefined,
      title: payload.title,
      description: payload.description,
    });
  } else if (actionType === "buffer_post") {
    const buffer = db
      .prepare("SELECT access_token FROM buffer_connections WHERE workspace_id = ?")
      .get(workspaceId) as { access_token: string } | undefined;
    if (!buffer) throw new Error("Buffer not connected");

    const settings = db
      .prepare("SELECT buffer_profile_id FROM workspace_automation_settings WHERE workspace_id = ?")
      .get(workspaceId) as { buffer_profile_id: string | null } | undefined;

    let profileId = payload.profileId || settings?.buffer_profile_id || null;
    if (!profileId) {
      const profiles = await fetchBufferProfiles(buffer.access_token);
      const defaultProfile = profiles.find((p) => p.isDefault) || profiles[0];
      profileId = defaultProfile?.id || null;
    }
    if (!profileId) throw new Error("No Buffer profile available");

    await createBufferUpdate(buffer.access_token, [profileId], payload.text, {
      link: payload.link || undefined,
      imageUrl: payload.imageUrl || undefined,
      title: payload.title,
      description: payload.description,
    });
  } else if (actionType === "instagram_post") {
    const ig = db
      .prepare("SELECT access_token, ig_user_id FROM instagram_connections WHERE workspace_id = ?")
      .get(workspaceId) as { access_token: string; ig_user_id: string } | undefined;
    if (!ig) throw new Error("Instagram not connected");

    // Two-step publish: create container then publish
    const containerRes = await fetch(
      `https://graph.facebook.com/v18.0/${ig.ig_user_id}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: payload.text,
          ...(payload.imageUrl ? { image_url: payload.imageUrl, media_type: "IMAGE" } : { media_type: "FEED" }),
          access_token: ig.access_token,
        }),
      },
    );
    if (!containerRes.ok) {
      const err = await containerRes.text().catch(() => "");
      throw new Error(err || `Instagram container creation failed with status ${containerRes.status}`);
    }
    const containerData = await containerRes.json() as { id?: string };
    if (!containerData.id) throw new Error("Instagram container creation did not return an ID");

    const publishRes = await fetch(
      `https://graph.facebook.com/v18.0/${ig.ig_user_id}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: containerData.id, access_token: ig.access_token }),
      },
    );
    if (!publishRes.ok) {
      const err = await publishRes.text().catch(() => "");
      throw new Error(err || `Instagram publish failed with status ${publishRes.status}`);
    }
  } else if (actionType === "twitter_post") {
    const tw = db
      .prepare("SELECT access_token FROM twitter_connections WHERE workspace_id = ?")
      .get(workspaceId) as { access_token: string } | undefined;
    if (!tw) throw new Error("X/Twitter not connected");

    const tweetRes = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tw.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: payload.text }),
    });
    if (!tweetRes.ok) {
      const err = await tweetRes.text().catch(() => "");
      throw new Error(err || `Twitter post failed with status ${tweetRes.status}`);
    }
  } else if (actionType === "facebook_post") {
    const fb = db
      .prepare("SELECT page_access_token, page_id FROM facebook_connections WHERE workspace_id = ?")
      .get(workspaceId) as { page_access_token: string; page_id: string } | undefined;
    if (!fb) throw new Error("Facebook not connected");

    const endpoint = payload.imageUrl
      ? `https://graph.facebook.com/v18.0/${fb.page_id}/photos`
      : `https://graph.facebook.com/v18.0/${fb.page_id}/feed`;

    const fbBody: Record<string, string> = {
      message: payload.text,
      access_token: fb.page_access_token,
    };
    if (payload.imageUrl) fbBody.url = payload.imageUrl;
    if (payload.link && !payload.imageUrl) fbBody.link = payload.link;

    const fbRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fbBody),
    });
    if (!fbRes.ok) {
      const err = await fbRes.text().catch(() => "");
      throw new Error(err || `Facebook post failed with status ${fbRes.status}`);
    }
  } else {
    throw new Error(`Unsupported action type: ${actionType}`);
  }
}

export function registerApprovalRoutes({
  app,
  db,
  requireAuth,
  requireWorkspaceAccess,
}: RegisterApprovalRoutesArgs) {
  // List approvals (default: pending)
  app.get(
    "/api/workspaces/:workspaceId/approvals",
    requireAuth,
    requireWorkspaceAccess,
    (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const status = (req.query.status as string) || "pending";
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      const validStatuses = new Set(["pending", "approved", "rejected", "all"]);
      if (!validStatuses.has(status)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }

      let rows: any[];
      if (status === "all") {
        rows = db
          .prepare(`
            SELECT id, workspace_id, task_id, agent_id, agent_name, action_type, payload,
                   status, requested_at, reviewed_at, reviewed_by_user_id, rejection_reason
            FROM approval_requests
            WHERE workspace_id = ?
            ORDER BY requested_at DESC
            LIMIT ?
          `)
          .all(workspaceId, limit);
      } else {
        rows = db
          .prepare(`
            SELECT id, workspace_id, task_id, agent_id, agent_name, action_type, payload,
                   status, requested_at, reviewed_at, reviewed_by_user_id, rejection_reason
            FROM approval_requests
            WHERE workspace_id = ? AND status = ?
            ORDER BY requested_at DESC
            LIMIT ?
          `)
          .all(workspaceId, status, limit);
      }

      const parsed = rows.map((row) => {
        let payloadObj: unknown = null;
        try { payloadObj = JSON.parse(row.payload); } catch { /* leave null */ }
        return { ...row, payload: payloadObj };
      });

      res.json(parsed);
    },
  );

  // Approve an approval request
  app.post(
    "/api/workspaces/:workspaceId/approvals/:approvalId/approve",
    requireAuth,
    requireWorkspaceAccess,
    async (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const userId = (req as AuthenticatedRequest).userId;
      const approvalId = Number(req.params.approvalId);

      const approval = db
        .prepare("SELECT * FROM approval_requests WHERE id = ? AND workspace_id = ?")
        .get(approvalId, workspaceId) as any;

      if (!approval) return res.status(404).json({ error: "Approval request not found" });
      if (approval.status !== "pending") {
        return res.status(409).json({ error: `Already ${approval.status}` });
      }

      try {
        await dispatchApprovedAction(db, workspaceId, approval.action_type, approval.payload);

        db.prepare(`
          UPDATE approval_requests
          SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?
          WHERE id = ?
        `).run(userId ?? null, approvalId);

        writeApprovalAuditLog(db, workspaceId, "approval.approved", {
          approvalId,
          actionType: approval.action_type,
          agentId: approval.agent_id,
          reviewedByUserId: userId,
        });

        res.json({ success: true });
      } catch (err: any) {
        writeApprovalAuditLog(db, workspaceId, "approval.dispatch_failed", {
          approvalId,
          actionType: approval.action_type,
          error: err?.message || "unknown_error",
        });
        res.status(500).json({ error: err?.message || "Failed to dispatch action" });
      }
    },
  );

  // Reject an approval request
  app.post(
    "/api/workspaces/:workspaceId/approvals/:approvalId/reject",
    requireAuth,
    requireWorkspaceAccess,
    (req: express.Request, res: express.Response) => {
      const workspaceId = Number((req as AuthenticatedRequest).workspaceId);
      const userId = (req as AuthenticatedRequest).userId;
      const approvalId = Number(req.params.approvalId);
      const { reason } = req.body as { reason?: string };

      const approval = db
        .prepare("SELECT id, status, action_type, agent_id FROM approval_requests WHERE id = ? AND workspace_id = ?")
        .get(approvalId, workspaceId) as any;

      if (!approval) return res.status(404).json({ error: "Approval request not found" });
      if (approval.status !== "pending") {
        return res.status(409).json({ error: `Already ${approval.status}` });
      }

      db.prepare(`
        UPDATE approval_requests
        SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?,
            rejection_reason = ?
        WHERE id = ?
      `).run(userId ?? null, reason?.trim() || null, approvalId);

      writeApprovalAuditLog(db, workspaceId, "approval.rejected", {
        approvalId,
        actionType: approval.action_type,
        agentId: approval.agent_id,
        reviewedByUserId: userId,
        reason: reason?.trim() || null,
      });

      res.json({ success: true });
    },
  );
}
