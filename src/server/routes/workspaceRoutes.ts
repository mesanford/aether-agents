import express from "express";
import crypto from "crypto";
import { Resend } from "resend";
import type { AuthenticatedRequest } from "../types.ts";
import { inferTaskExecutionType } from "../taskExecution.ts";
import { enqueueAutomationJob } from "../taskEngine.ts";
import { uploadBase64ToGCS, getSignedUrlForGcs, deleteGCSFile } from "../gcpStorage.ts";

import type { PostgresShim } from "../db.ts";

type DatabaseLike = PostgresShim;

type RegisterWorkspaceRoutesArgs = {
  app: express.Application;
  db: DatabaseLike;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
  requireWorkspaceRole: (...allowedRoles: string[]) => express.RequestHandler;
  getAllowedAgentUpdate: (body: any) => { updates?: Record<string, unknown>; error?: string };
  getAllowedTaskCreate: (body: any) => { value?: { title: string; description: string; assigneeId: string; dueDate: string; repeat: string }; error?: string };
  getAllowedTaskStatusUpdate: (body: any) => { status?: string; error?: string };
  getAllowedMessageCreate: (body: any) => { value?: { agentId: string; senderId: string; senderName: string; senderAvatar: string; content: string; imageUrl: string | null; timestamp: number; type: string }; error?: string };
  isNonEmptyString: (value: unknown) => value is string;
  writeAuditLog: (params: { workspaceId?: number; userId?: number; action: string; resource: string; details?: Record<string, unknown> }) => void;
  seedWorkspace: (workspaceId: number | bigint) => Promise<void>;
};

export function registerWorkspaceRoutes({
  app,
  db,
  requireAuth,
  requireWorkspaceAccess,
  requireWorkspaceRole,
  getAllowedAgentUpdate,
  getAllowedTaskCreate,
  getAllowedTaskStatusUpdate,
  getAllowedMessageCreate,
  isNonEmptyString,
  writeAuditLog,
  seedWorkspace,
}: RegisterWorkspaceRoutesArgs) {
  const VALID_PERSONALITY_TONES = new Set(["warm", "direct", "analytical", "playful", "formal"]);
  const VALID_PERSONALITY_STYLES = new Set(["concise", "balanced", "detailed"]);
  const VALID_PERSONALITY_ASSERTIVENESS = new Set(["low", "medium", "high"]);
  const VALID_PERSONALITY_HUMOR = new Set(["none", "light"]);
  const VALID_PERSONALITY_VERBOSITY = new Set(["short", "medium", "long"]);

  const isLikelyImageValue = (value: string) => /^data:image\//i.test(value) || /^https?:\/\//i.test(value);

  const formatArtifactAsLeadNote = (params: {
    artifact: { title: string; body: string; bullets: string[]; imageUrl?: string };
    taskTitle: string;
    assigneeName?: string;
  }) => {
    const heading = `Task artifact: ${params.taskTitle}`;
    const authorLine = params.assigneeName ? `Prepared by ${params.assigneeName}` : null;
    const imageLine = params.artifact.imageUrl ? `Image: ${params.artifact.imageUrl}` : null;
    const bulletLines = params.artifact.bullets
      .filter((bullet) => isNonEmptyString(bullet))
      .map((bullet) => `- ${bullet.trim()}`);

    return [
      heading,
      authorLine,
      params.artifact.title,
      params.artifact.body,
      imageLine,
      ...bulletLines,
    ]
      .filter((line): line is string => Boolean(line && line.trim()))
      .join("\n");
  };

  const buildDefaultPersonalityByRole = (role?: string) => {
    switch (role) {
      case "Executive Assistant":
        return { tone: "warm", communicationStyle: "concise", assertiveness: "medium", humor: "none", verbosity: "short", signaturePhrase: "I've prepared the next step for you.", doNots: ["Do not use slang."] };
      case "Social Media Manager":
        return { tone: "playful", communicationStyle: "balanced", assertiveness: "high", humor: "light", verbosity: "medium", signaturePhrase: "Let's make this one scroll-stopping.", doNots: ["Do not sound robotic."] };
      case "Blog Writer":
        return { tone: "analytical", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "long", signaturePhrase: "Here is the narrative arc and data spine.", doNots: ["Do not overuse buzzwords."] };
      case "Sales Associate":
        return { tone: "direct", communicationStyle: "concise", assertiveness: "high", humor: "light", verbosity: "short", signaturePhrase: "I'll convert this into pipeline momentum.", doNots: ["Do not hedge recommendations."] };
      case "Legal Associate":
        return { tone: "formal", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "medium", signaturePhrase: "Risk exposure is noted and bounded.", doNots: ["Do not provide certainty without caveats."] };
      case "Receptionist":
        return { tone: "warm", communicationStyle: "concise", assertiveness: "low", humor: "none", verbosity: "short", signaturePhrase: "I can help route this quickly.", doNots: ["Do not sound abrupt."] };
      default:
        return { tone: "warm", communicationStyle: "balanced", assertiveness: "medium", humor: "light", verbosity: "medium", signaturePhrase: "Let's align on the next move.", doNots: ["Do not dominate individual agent voices."] };
    }
  };

  const parseAgentPersonality = (raw: string | null | undefined, role?: string) => {
    if (!raw) {
      return buildDefaultPersonalityByRole(role);
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        return buildDefaultPersonalityByRole(role);
      }

      const fallback = buildDefaultPersonalityByRole(role);
      const doNots = Array.isArray(parsed.doNots)
        ? parsed.doNots.filter((item): item is string => typeof item === "string")
        : fallback.doNots;

      return {
        tone: typeof parsed.tone === "string" ? parsed.tone : fallback.tone,
        communicationStyle: typeof parsed.communicationStyle === "string" ? parsed.communicationStyle : fallback.communicationStyle,
        assertiveness: typeof parsed.assertiveness === "string" ? parsed.assertiveness : fallback.assertiveness,
        humor: typeof parsed.humor === "string" ? parsed.humor : fallback.humor,
        verbosity: typeof parsed.verbosity === "string" ? parsed.verbosity : fallback.verbosity,
        signaturePhrase: typeof parsed.signaturePhrase === "string" ? parsed.signaturePhrase : fallback.signaturePhrase,
        doNots,
      };
    } catch {
      return buildDefaultPersonalityByRole(role);
    }
  };

  const normalizePersonalityForFingerprint = (personality: Record<string, unknown>, role?: string) => {
    const fallback = buildDefaultPersonalityByRole(role);
    const safeTone = typeof personality.tone === "string" && VALID_PERSONALITY_TONES.has(personality.tone)
      ? personality.tone
      : fallback.tone;
    const safeStyle = typeof personality.communicationStyle === "string" && VALID_PERSONALITY_STYLES.has(personality.communicationStyle)
      ? personality.communicationStyle
      : fallback.communicationStyle;
    const safeAssertiveness = typeof personality.assertiveness === "string" && VALID_PERSONALITY_ASSERTIVENESS.has(personality.assertiveness)
      ? personality.assertiveness
      : fallback.assertiveness;
    const safeHumor = typeof personality.humor === "string" && VALID_PERSONALITY_HUMOR.has(personality.humor)
      ? personality.humor
      : fallback.humor;
    const safeVerbosity = typeof personality.verbosity === "string" && VALID_PERSONALITY_VERBOSITY.has(personality.verbosity)
      ? personality.verbosity
      : fallback.verbosity;
    const safeSignature = typeof personality.signaturePhrase === "string" ? personality.signaturePhrase.trim().toLowerCase() : "";
    const safeDoNots = Array.isArray(personality.doNots)
      ? personality.doNots
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length > 0)
      : [];

    return {
      tone: safeTone,
      communicationStyle: safeStyle,
      assertiveness: safeAssertiveness,
      humor: safeHumor,
      verbosity: safeVerbosity,
      signaturePhrase: safeSignature,
      doNots: Array.from(new Set(safeDoNots)).sort(),
    };
  };

  const personalityFingerprint = (personality: Record<string, unknown>, role?: string) => {
    return JSON.stringify(normalizePersonalityForFingerprint(personality, role));
  };

  const areSignaturePhrasesSimilar = (left: string, right: string) => {
    if (!left || !right) {
      return false;
    }

    if (left === right) {
      return true;
    }

    if (Math.min(left.length, right.length) < 12) {
      return false;
    }

    return left.includes(right) || right.includes(left);
  };

  const getDoNotOverlapRatio = (left: string[], right: string[]) => {
    if (left.length === 0 || right.length === 0) {
      return 0;
    }

    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const union = new Set([...leftSet, ...rightSet]);
    let overlap = 0;

    for (const value of leftSet) {
      if (rightSet.has(value)) {
        overlap += 1;
      }
    }

    return union.size > 0 ? overlap / union.size : 0;
  };

  const isNearDuplicatePersonality = (
    leftPersonality: Record<string, unknown>,
    leftRole: string | undefined,
    rightPersonality: Record<string, unknown>,
    rightRole: string | undefined,
  ) => {
    const left = normalizePersonalityForFingerprint(leftPersonality, leftRole);
    const right = normalizePersonalityForFingerprint(rightPersonality, rightRole);

    const coreMatches = [
      left.tone === right.tone,
      left.communicationStyle === right.communicationStyle,
      left.assertiveness === right.assertiveness,
      left.humor === right.humor,
      left.verbosity === right.verbosity,
    ].filter(Boolean).length;

    const signatureSimilar = areSignaturePhrasesSimilar(left.signaturePhrase, right.signaturePhrase);
    const doNotOverlapRatio = getDoNotOverlapRatio(left.doNots, right.doNots);

    if (coreMatches === 5) {
      return true;
    }

    if (coreMatches >= 4 && (signatureSimilar || doNotOverlapRatio >= 0.5)) {
      return true;
    }

    return false;
  };

  app.get("/api/workspaces", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const workspaces = await db.prepare(`
        SELECT w.*, COALESCE(wm.role, 'owner') as role 
        FROM workspaces w 
        LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = ?
        WHERE wm.user_id = ? OR w.owner_id = ?
      `).all(req.userId, req.userId, req.userId);

      res.json(workspaces);
    } catch {
      res.status(500).json({ error: "Failed to fetch workspaces" });
    }
  });

  app.post("/api/workspaces", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Workspace name is required" });

      const result = await db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?) RETURNING id").get(name, req.userId) as any;
      const workspaceId = result.id;

      await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, req.userId, "owner");
      await seedWorkspace(workspaceId).catch(console.error);

      res.json({ id: workspaceId, name, role: "owner" });
    } catch {
      res.status(500).json({ error: "Failed to create workspace" });
    }
  });

  app.patch("/api/workspaces/:id", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, logo, description, target_audience } = req.body;
      if (name !== undefined) {
        await db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, req.workspaceId);
      }
      if (logo !== undefined) {
        await db.prepare("UPDATE workspaces SET logo = ? WHERE id = ?").run(logo, req.workspaceId);
      }
      if (description !== undefined) {
        await db.prepare("UPDATE workspaces SET description = ? WHERE id = ?").run(description, req.workspaceId);
      }
      if (target_audience !== undefined) {
        await db.prepare("UPDATE workspaces SET target_audience = ? WHERE id = ?").run(target_audience, req.workspaceId);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update workspace details" });
    }
  });

  app.delete("/api/workspaces/:id", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner"), async (req: AuthenticatedRequest, res) => {
    try {
      const workspaceId = req.workspaceId;
      
      const queries = [
        "DELETE FROM sequence_events WHERE workspace_id = ?",
        "DELETE FROM sequence_enrollments WHERE workspace_id = ?",
        "DELETE FROM messages WHERE workspace_id = ?",
        "DELETE FROM approval_requests WHERE workspace_id = ?",
        "DELETE FROM tasks WHERE workspace_id = ?",
        "DELETE FROM agents WHERE workspace_id = ?",
        "DELETE FROM leads WHERE workspace_id = ?",
        "DELETE FROM sales_sequences WHERE workspace_id = ?",
        "DELETE FROM workspace_members WHERE workspace_id = ?",
        "DELETE FROM workspace_invitations WHERE workspace_id = ?",
        "DELETE FROM workspace_google_defaults WHERE workspace_id = ?",
        "DELETE FROM wordpress_connections WHERE workspace_id = ?",
        "DELETE FROM hubspot_connections WHERE workspace_id = ?",
        "DELETE FROM linkedin_connections WHERE workspace_id = ?",
        "DELETE FROM buffer_connections WHERE workspace_id = ?",
        "DELETE FROM twilio_connections WHERE workspace_id = ?",
        "DELETE FROM slack_connections WHERE workspace_id = ?",
        "DELETE FROM teams_connections WHERE workspace_id = ?",
        "DELETE FROM notion_connections WHERE workspace_id = ?",
        "DELETE FROM stan_memory_ledger WHERE workspace_id = ?",
        "DELETE FROM media_assets WHERE workspace_id = ?",
        "DELETE FROM workspace_automation_settings WHERE workspace_id = ?",
        "DELETE FROM knowledge_documents WHERE workspace_id = ?",
        "DELETE FROM audit_logs WHERE workspace_id = ?",
        "DELETE FROM workspace_webhook_secrets WHERE workspace_id = ?",
        "DELETE FROM automation_jobs WHERE workspace_id = ?",
        "DELETE FROM workspaces WHERE id = ?"
      ];

      // Execute safely in sequence
      for (const q of queries) {
        await db.prepare(q).run(workspaceId);
      }
      
      res.json({ success: true, message: "Workspace deleted successfully." });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  });
  const resendUrl = process.env.VITE_APP_URL || "http://localhost:3000";
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  const sendInvitationEmail = async (email: string, inviteId: string, workspaceName: string, role: string) => {
    if (!resend) {
      console.warn("RESEND_API_KEY is not set. Skipping invitation email.");
      return;
    }
    const inviteLink = `${resendUrl}/invite?token=${inviteId}`;
    try {
      await resend.emails.send({
        from: 'AgencyOS <noreply@agencyos.dev>',
        to: email,
        subject: `You have been invited to join ${workspaceName}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Join your team on AgencyOS</h2>
            <p>You have been invited to join the workspace <strong>${workspaceName}</strong> as a(n) ${role}.</p>
            <p>Click the link below to accept your invitation:</p>
            <a href="${inviteLink}" style="display: inline-block; padding: 10px 20px; background-color: #0f172a; color: #fff; text-decoration: none; border-radius: 6px;">Accept Invitation</a>
            <p style="margin-top: 20px; font-size: 12px; color: #64748b;">If you did not expect this invitation, you can ignore this email.</p>
          </div>
        `
      });
    } catch (err) {
      console.error("Failed to send invitation email via Resend:", err);
    }
  };

  app.post("/api/workspaces/:id/complete-onboarding", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      await db.prepare("UPDATE workspaces SET is_onboarded = true WHERE id = ?").run(req.workspaceId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to complete onboarding" });
    }
  });

  app.get("/api/workspaces/:id/members", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const members = await db.prepare(`
        SELECT u.id, u.email, u.name, wm.role 
        FROM users u 
        JOIN workspace_members wm ON u.id = wm.user_id 
        WHERE wm.workspace_id = ?
      `).all(req.workspaceId);
      res.json(members);
    } catch {
      res.status(500).json({ error: "Failed to fetch members" });
    }
  });

  app.post(
    "/api/workspaces/:id/members",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const { email, role } = req.body as { email?: string; role?: string };
        if (!isNonEmptyString(email)) {
          return res.status(400).json({ error: "email is required" });
        }

        const normalizedRole = isNonEmptyString(role) ? role.trim().toLowerCase() : "member";
        if (!["owner", "admin", "member"].includes(normalizedRole)) {
          return res.status(400).json({ error: "Invalid role" });
        }

        if (normalizedRole === "owner") {
          return res.status(400).json({ error: "Use role update flow for ownership transfer" });
        }

        const user = await db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email.trim()) as
          | { id: number; email: string; name: string | null }
          | undefined;

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const existing = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(req.workspaceId, user.id) as { role: string } | undefined;

        if (existing) {
          await db.prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(
            normalizedRole,
            req.workspaceId,
            user.id,
          );
          writeAuditLog({
            workspaceId: req.workspaceId,
            userId: req.userId,
            action: "workspace.member.role_updated",
            resource: "workspace_members",
            details: { memberUserId: user.id, role: normalizedRole, mode: "upsert" },
          });
          return res.json({ id: user.id, email: user.email, name: user.name, role: normalizedRole });
        }

        await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(
          req.workspaceId,
          user.id,
          normalizedRole,
        );

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.member.added",
          resource: "workspace_members",
          details: { memberUserId: user.id, role: normalizedRole },
        });

        return res.json({ id: user.id, email: user.email, name: user.name, role: normalizedRole });
      } catch {
        return res.status(500).json({ error: "Failed to add member" });
      }
    },
  );

  app.patch(
    "/api/workspaces/:workspaceId/members/:memberUserId",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const memberUserId = Number.parseInt(req.params.memberUserId, 10);
        if (!Number.isInteger(memberUserId)) {
          return res.status(400).json({ error: "Invalid member user id" });
        }

        const role = typeof req.body?.role === "string" ? req.body.role.trim().toLowerCase() : "";
        if (!["owner", "admin", "member"].includes(role)) {
          return res.status(400).json({ error: "Invalid role" });
        }

        if (req.workspaceRole === "admin" && role === "owner") {
          return res.status(403).json({ error: "Only owners can promote to owner" });
        }

        const target = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(req.workspaceId, memberUserId) as { role: string } | undefined;

        if (!target) {
          return res.status(404).json({ error: "Member not found" });
        }

        if (target.role === "owner" && req.workspaceRole !== "owner") {
          return res.status(403).json({ error: "Only owners can modify owner roles" });
        }

        if (target.role === "owner" && role !== "owner") {
          const ownerCountRow = await db.prepare("SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(req.workspaceId) as { count: number };
          if (ownerCountRow.count <= 1) {
            return res.status(400).json({ error: "Workspace must retain at least one owner" });
          }
        }

        await db.prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(
          role,
          req.workspaceId,
          memberUserId,
        );

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.member.role_updated",
          resource: "workspace_members",
          details: { memberUserId, role },
        });

        return res.json({ success: true });
      } catch {
        return res.status(500).json({ error: "Failed to update member role" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:workspaceId/members/:memberUserId",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const memberUserId = Number.parseInt(req.params.memberUserId, 10);
        if (!Number.isInteger(memberUserId)) {
          return res.status(400).json({ error: "Invalid member user id" });
        }

        const target = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(req.workspaceId, memberUserId) as { role: string } | undefined;

        if (!target) {
          return res.status(404).json({ error: "Member not found" });
        }

        if (target.role === "owner") {
          const ownerCountRow = await db.prepare("SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = ? AND role = 'owner'").get(req.workspaceId) as { count: number };
          if (ownerCountRow.count <= 1) {
            return res.status(400).json({ error: "Workspace must retain at least one owner" });
          }
        }

        await db.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(req.workspaceId, memberUserId);
        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.member.removed",
          resource: "workspace_members",
          details: { memberUserId },
        });
        return res.json({ success: true });
      } catch {
        return res.status(500).json({ error: "Failed to remove member" });
      }
    },
  );

  app.get("/api/workspaces/:id/invites", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const invites = await db.prepare("SELECT * FROM workspace_invitations WHERE workspace_id = ? ORDER BY created_at DESC").all(req.workspaceId);
      res.json(invites);
    } catch {
      res.status(500).json({ error: "Failed to fetch invites" });
    }
  });

  app.post(
    "/api/workspaces/:id/invites",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { email, role } = req.body as { email?: string; role?: string };
        if (!isNonEmptyString(email)) {
          return res.status(400).json({ error: "Email is required" });
        }

        const normalizedRole = isNonEmptyString(role) ? role.trim().toLowerCase() : "member";
        if (!["owner", "admin", "member"].includes(normalizedRole)) {
          return res.status(400).json({ error: "Invalid role" });
        }

        // Check if user is already a member
        const user = await db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim()) as { id: number } | undefined;
        if (user) {
          const existingMember = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(req.workspaceId, user.id);
          if (existingMember) {
            return res.status(400).json({ error: "User is already a member of this workspace" });
          }
        }

        const inviteId = crypto.randomUUID();
        await db.prepare("INSERT INTO workspace_invitations (id, workspace_id, email, role, status) VALUES (?, ?, ?, ?, ?)").run(
          inviteId,
          req.workspaceId,
          email.trim(),
          normalizedRole,
          'pending'
        );

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.invite.created",
          resource: "workspace_invitations",
          details: { email, role: normalizedRole },
        });

        // Get workspace name for the email
        const workspace = await db.prepare("SELECT name FROM workspaces WHERE id = ?").get(req.workspaceId) as { name: string };
        await sendInvitationEmail(email.trim(), inviteId, workspace?.name || "Workspace", normalizedRole);

        const newInvite = await db.prepare("SELECT * FROM workspace_invitations WHERE id = ?").get(inviteId);
        res.json(newInvite);
      } catch (err) {
        console.error("Failed to create invite:", err);
        res.status(500).json({ error: "Failed to create invite" });
      }
    }
  );

  app.post(
    "/api/workspaces/:id/invites/:inviteId/resend",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const invite = await db.prepare("SELECT * FROM workspace_invitations WHERE id = ? AND workspace_id = ?").get(req.params.inviteId, req.workspaceId) as { email: string, role: string } | undefined;
        if (!invite) return res.status(404).json({ error: "Invite not found" });

        const workspace = await db.prepare("SELECT name FROM workspaces WHERE id = ?").get(req.workspaceId) as { name: string };
        await sendInvitationEmail(invite.email, req.params.inviteId, workspace?.name || "Workspace", invite.role);

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.invite.resent",
          resource: "workspace_invitations",
          details: { inviteId: req.params.inviteId },
        });

        res.json({ success: true, message: "Invitation resent" });
      } catch {
        res.status(500).json({ error: "Failed to resend invite" });
      }
    }
  );

  app.delete(
    "/api/workspaces/:id/invites/:inviteId",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const result = await db.prepare("DELETE FROM workspace_invitations WHERE id = ? AND workspace_id = ?").run(req.params.inviteId, req.workspaceId);
        
        if (result.changes === 0) {
          return res.status(404).json({ error: "Invite not found" });
        }

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.invite.revoked",
          resource: "workspace_invitations",
          details: { inviteId: req.params.inviteId },
        });

        res.json({ success: true });
      } catch {
        res.status(500).json({ error: "Failed to revoke invite" });
      }
    }
  );

  app.get("/api/workspaces/:id/leads", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    const leads = await db.prepare("SELECT * FROM leads WHERE workspace_id = ? ORDER BY id DESC").all(req.workspaceId);
    res.json(leads);
  });

  app.post("/api/workspaces/:id/leads", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    const { name, role, company, location, email, status, sequence, linkedin_url, avatar } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Lead name is required" });
    }

    const result = await db.prepare(`
      INSERT INTO leads (name, role, company, location, email, status, sequence, linkedin_url, avatar, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).get(name.trim(), role, company, location, email, status || "New Lead", sequence || "None", linkedin_url, avatar, req.workspaceId) as any;
    writeAuditLog({
      workspaceId: req.workspaceId,
      userId: req.userId,
      action: "lead.created",
      resource: "leads",
      details: { leadId: result.id },
    });
    return res.json({ id: result.id });
  });

  app.patch("/api/workspaces/:workspaceId/leads/:id", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    const { id } = req.params;
    const allowedFields = new Set([
      "name",
      "role",
      "company",
      "location",
      "email",
      "status",
      "sequence",
      "linkedin_url",
      "avatar",
    ]);

    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.has(key))
    );

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = Object.values(updates);
    const result = await db.prepare(`UPDATE leads SET ${setClause} WHERE id = ? AND workspace_id = ?`).run(...values, id, req.workspaceId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    writeAuditLog({
      workspaceId: req.workspaceId,
      userId: req.userId,
      action: "lead.updated",
      resource: "leads",
      details: { leadId: Number.parseInt(id, 10), fields: keys },
    });

    return res.json({ success: true });
  });

  app.get("/api/workspaces/:id/sequences", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const sequences = await db.prepare("SELECT * FROM sales_sequences WHERE workspace_id = ? ORDER BY id DESC").all(req.workspaceId);
      res.json(sequences);
    } catch {
      res.status(500).json({ error: "Failed to fetch sequences" });
    }
  });

  app.post("/api/workspaces/:id/sequences", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    const { title, status, schedule, steps } = req.body;
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "Title is required" });
    }
    
    try {
      const stepsJson = Array.isArray(steps) ? JSON.stringify(steps) : '[]';
      const result = await db.prepare(`
        INSERT INTO sales_sequences (workspace_id, title, status, schedule, steps)
        VALUES (?, ?, ?, ?, ?) RETURNING id
      `).get(req.workspaceId, title, status || 'Draft', schedule || 'Runs every day', stepsJson) as any;
      
      res.json({ id: result.id });
    } catch {
      res.status(500).json({ error: "Failed to create sequence" });
    }
  });

  app.patch("/api/workspaces/:id/sequences/:seqId", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { title, status, schedule, steps } = req.body;
      const seqId = req.params.seqId;

      const updates: string[] = [];
      const values: any[] = [];

      if (title !== undefined) { updates.push("title = ?"); values.push(title); }
      if (status !== undefined) { updates.push("status = ?"); values.push(status); }
      if (schedule !== undefined) { updates.push("schedule = ?"); values.push(schedule); }
      if (steps !== undefined) { updates.push("steps = ?"); values.push(typeof steps === 'string' ? steps : JSON.stringify(steps)); }

      if (updates.length > 0) {
        updates.push("updated_at = CURRENT_TIMESTAMP");
        values.push(seqId, req.workspaceId);
        await db.prepare(`UPDATE sales_sequences SET ${updates.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...values);
      }

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update sequence" });
    }
  });

  app.get("/api/workspaces/:id/agents", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const rows = await db.prepare("SELECT * FROM agents WHERE workspace_id = ?").all(req.workspaceId) as any[];
      const agents = rows.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        description: a.description,
        avatar: a.avatar,
        capabilities: JSON.parse(a.capabilities || "[]"),
        guidelines: JSON.parse(a.guidelines || "[]"),
        personality: parseAgentPersonality(a.personality, a.role),
        lastAction: a.last_action,
      }));
      res.json(agents);
    } catch {
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  });

  app.patch("/api/workspaces/:workspaceId/agents/:agentId", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const { agentId } = req.params;
      const { updates, error } = getAllowedAgentUpdate(req.body);
      if (error) {
        return res.status(400).json({ error });
      }

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      const existingAgent = await db.prepare("SELECT description, guidelines, capabilities, personality, role FROM agents WHERE id = ? AND workspace_id = ?").get(agentId, req.workspaceId) as {
        description?: string | null;
        guidelines?: string | null;
        capabilities?: string | null;
        personality?: string | null;
        role?: string | null;
      } | undefined;

      if (updates.personality !== undefined) {
        const nextPersonalityFingerprint = personalityFingerprint(updates.personality as Record<string, unknown>, existingAgent?.role || undefined);
        const siblingAgents = await db.prepare("SELECT id, personality, role FROM agents WHERE workspace_id = ? AND id != ?").all(req.workspaceId, agentId) as Array<{
          id: string;
          personality?: string | null;
          role?: string | null;
        }>;

        const duplicateProfile = siblingAgents.some((agent) => {
          const siblingPersonality = parseAgentPersonality(agent.personality || null, agent.role || undefined) as Record<string, unknown>;
          return personalityFingerprint(siblingPersonality, agent.role || undefined) === nextPersonalityFingerprint
            || isNearDuplicatePersonality(
              updates.personality as Record<string, unknown>,
              existingAgent?.role || undefined,
              siblingPersonality,
              agent.role || undefined,
            );
        });

        if (duplicateProfile) {
          return res.status(409).json({ error: "Personality profile must be meaningfully distinct across agents in this workspace" });
        }
      }

      if (updates.status !== undefined) await db.prepare("UPDATE agents SET status = ? WHERE id = ? AND workspace_id = ?").run(updates.status, agentId, req.workspaceId);
      if (updates.name !== undefined) await db.prepare("UPDATE agents SET name = ? WHERE id = ? AND workspace_id = ?").run(updates.name, agentId, req.workspaceId);
      if (updates.guidelines !== undefined) await db.prepare("UPDATE agents SET guidelines = ? WHERE id = ? AND workspace_id = ?").run(JSON.stringify(updates.guidelines), agentId, req.workspaceId);
      if (updates.description !== undefined) await db.prepare("UPDATE agents SET description = ? WHERE id = ? AND workspace_id = ?").run(updates.description, agentId, req.workspaceId);
      if (updates.capabilities !== undefined) await db.prepare("UPDATE agents SET capabilities = ? WHERE id = ? AND workspace_id = ?").run(JSON.stringify(updates.capabilities), agentId, req.workspaceId);
      if (updates.personality !== undefined) await db.prepare("UPDATE agents SET personality = ? WHERE id = ? AND workspace_id = ?").run(JSON.stringify(updates.personality), agentId, req.workspaceId);
      writeAuditLog({
        workspaceId: req.workspaceId,
        userId: req.userId,
        action: "agent.updated",
        resource: "agents",
        details: { agentId, fields: Object.keys(updates) },
      });

      const promptFieldsUpdated = ["description", "guidelines", "capabilities", "personality"].some((field) => field in updates);
      if (promptFieldsUpdated && existingAgent) {
        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "agent.prompt_context.versioned",
          resource: "agents",
          details: {
            agentId,
            versionAt: Date.now(),
            before: {
              description: existingAgent.description || "",
              guidelines: JSON.parse(existingAgent.guidelines || "[]"),
              capabilities: JSON.parse(existingAgent.capabilities || "[]"),
              personality: parseAgentPersonality(existingAgent.personality || null, existingAgent.role || undefined),
            },
            after: {
              description: updates.description !== undefined ? updates.description : (existingAgent.description || ""),
              guidelines: updates.guidelines !== undefined ? updates.guidelines : JSON.parse(existingAgent.guidelines || "[]"),
              capabilities: updates.capabilities !== undefined ? updates.capabilities : JSON.parse(existingAgent.capabilities || "[]"),
              personality: updates.personality !== undefined
                ? updates.personality
                : parseAgentPersonality(existingAgent.personality || null, existingAgent.role || undefined),
            },
          },
        });
      }
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "Failed to update agent" });
    }
  });

  app.get("/api/workspaces/:id/tasks", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const rows = await db.prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY rowid ASC").all(req.workspaceId) as any[];
      const tasks = rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assigneeId: t.assignee_id,
        status: t.status,
        executionType: t.execution_type,
        outputSummary: t.output_summary,
        lastError: t.last_error,
        lastRunAt: t.last_run_at,
        startedAt: t.started_at,
        completedAt: t.completed_at,
        selectedMediaAssetId: t.selected_media_asset_id,
        artifactType: t.artifact_type,
        artifact: t.artifact_payload ? JSON.parse(t.artifact_payload) : null,
        dueDate: t.due_date,
        repeat: t.repeat,
      }));
      res.json(tasks);
    } catch {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.delete("/api/workspaces/:id/tasks/:taskId", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await db.prepare("DELETE FROM tasks WHERE id = ? AND workspace_id = ?").run(req.params.taskId, req.workspaceId);
      if (result.changes === 0) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json({ success: true, message: "Task deleted" });
    } catch {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });


  app.post("/api/workspaces/:id/tasks", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const { value, error } = getAllowedTaskCreate(req.body);
      if (error || !value) {
        return res.status(400).json({ error: error || "Invalid task payload" });
      }

      const assignee = await db.prepare("SELECT role FROM agents WHERE id = ? AND workspace_id = ?").get(value.assigneeId, req.workspaceId) as { role: string } | undefined;
      if (!assignee) {
        return res.status(400).json({ error: "Invalid task assignee" });
      }

      const executionType = inferTaskExecutionType({
        taskTitle: value.title,
        taskDescription: value.description,
        agentRole: assignee.role,
      });

      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}:${req.workspaceId}`;
      await db.prepare("INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(taskId, req.workspaceId, value.title, value.description, value.assigneeId, "todo", executionType, value.dueDate, value.repeat);
      writeAuditLog({
        workspaceId: req.workspaceId,
        userId: req.userId,
        action: "task.created",
        resource: "tasks",
        details: { taskId, assigneeId: value.assigneeId },
      });
      return res.json({ id: taskId, title: value.title, description: value.description, assigneeId: value.assigneeId, status: "todo", executionType, outputSummary: null, lastError: null, lastRunAt: null, startedAt: null, completedAt: null, selectedMediaAssetId: null, artifactType: null, artifact: null, dueDate: value.dueDate, repeat: value.repeat });
    } catch {
      return res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.patch(
    "/api/workspaces/:workspaceId/tasks/:taskId/selected-media",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const taskId = req.params.taskId;
        const selectedMediaAssetIdRaw = req.body?.selectedMediaAssetId;

        if (selectedMediaAssetIdRaw === null || selectedMediaAssetIdRaw === undefined || selectedMediaAssetIdRaw === "") {
          const result = await db.prepare("UPDATE tasks SET selected_media_asset_id = NULL WHERE id = ? AND workspace_id = ?").run(taskId, req.workspaceId);
          if (!result.changes) {
            return res.status(404).json({ error: "Task not found" });
          }

          writeAuditLog({
            workspaceId: req.workspaceId,
            userId: req.userId,
            action: "task.selected_media.cleared",
            resource: "tasks",
            details: { taskId },
          });

          return res.json({ success: true, selectedMediaAssetId: null });
        }

        const selectedMediaAssetId = Number.parseInt(String(selectedMediaAssetIdRaw), 10);
        if (!Number.isInteger(selectedMediaAssetId)) {
          return res.status(400).json({ error: "selectedMediaAssetId must be an integer or null" });
        }

        const mediaAsset = await db.prepare("SELECT id FROM media_assets WHERE id = ? AND workspace_id = ?").get(selectedMediaAssetId, req.workspaceId) as { id: number } | undefined;
        if (!mediaAsset) {
          return res.status(404).json({ error: "Media asset not found" });
        }

        const result = await db.prepare("UPDATE tasks SET selected_media_asset_id = ? WHERE id = ? AND workspace_id = ?").run(
          selectedMediaAssetId,
          taskId,
          req.workspaceId,
        );

        if (!result.changes) {
          return res.status(404).json({ error: "Task not found" });
        }

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "task.selected_media.updated",
          resource: "tasks",
          details: { taskId, selectedMediaAssetId },
        });

        return res.json({ success: true, selectedMediaAssetId });
      } catch {
        return res.status(500).json({ error: "Failed to update selected media" });
      }
    },
  );

  app.get(
    "/api/workspaces/:workspaceId/agents/:agentId/prompt-versions",
    requireAuth,
    requireWorkspaceAccess,
    async (req: AuthenticatedRequest, res) => {
      try {
        const agentId = req.params.agentId;
        const parsedLimit = Number.parseInt(String(req.query.limit || "10"), 10);
        const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 50)
          : 10;

        const rows = await db.prepare(`
            SELECT id, user_id, details, created_at
            FROM audit_logs
            WHERE workspace_id = ? AND action = 'agent.prompt_context.versioned'
            ORDER BY id DESC
            LIMIT 200
          `).all(req.workspaceId) as Array<{ id: number; user_id: number | null; details: string | null; created_at: string | null }>;

        const versions = rows
          .map((row) => {
            let details: Record<string, unknown> | null = null;
            if (row.details) {
              try {
                details = JSON.parse(row.details) as Record<string, unknown>;
              } catch {
                details = null;
              }
            }

            if (details?.agentId !== agentId) {
              return null;
            }

            return {
              id: row.id,
              userId: row.user_id,
              before: (details?.before || null) as Record<string, unknown> | null,
              after: (details?.after || null) as Record<string, unknown> | null,
              versionAt: typeof details?.versionAt === "number" ? details.versionAt : null,
              createdAt: row.created_at,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .slice(0, limit);

        return res.json(versions);
      } catch {
        return res.status(500).json({ error: "Failed to fetch prompt versions" });
      }
    },
  );

  app.get(
    "/api/workspaces/:workspaceId/tasks/:taskId/automation-logs",
    requireAuth,
    requireWorkspaceAccess,
    async (req: AuthenticatedRequest, res) => {
      try {
        const taskId = req.params.taskId;
        const parsedLimit = Number.parseInt(String(req.query.limit || "20"), 10);
        const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 100)
          : 20;

        const rows = await db.prepare(`
            SELECT id, action, details, created_at
            FROM audit_logs
            WHERE workspace_id = ? AND action LIKE 'task.automation.%'
            ORDER BY id DESC
            LIMIT 200
          `).all(req.workspaceId) as Array<{ id: number; action: string; details: string | null; created_at: string | null }>;

        const logs = rows
          .map((row) => {
            let details: Record<string, unknown> | null = null;
            if (row.details) {
              try {
                details = JSON.parse(row.details) as Record<string, unknown>;
              } catch {
                details = null;
              }
            }

            return {
              id: row.id,
              action: row.action,
              details,
              createdAt: row.created_at,
            };
          })
          .filter((entry) => entry.details?.taskId === taskId)
          .slice(0, limit);

        return res.json(logs);
      } catch {
        return res.status(500).json({ error: "Failed to fetch automation logs" });
      }
    },
  );

  app.post(
    "/api/workspaces/:workspaceId/tasks/:taskId/automation-retry",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const taskId = req.params.taskId;
        const task = await db.prepare("SELECT id, artifact_payload FROM tasks WHERE id = ? AND workspace_id = ?").get(taskId, req.workspaceId) as { id: string; artifact_payload: string | null } | undefined;

        if (!task) {
          return res.status(404).json({ error: "Task not found" });
        }

        if (!task.artifact_payload) {
          return res.status(400).json({ error: "Task artifact not found" });
        }

        try {
          const artifact = JSON.parse(task.artifact_payload) as Record<string, unknown>;
          if (
            !artifact
            || typeof artifact.title !== "string"
            || typeof artifact.body !== "string"
            || !Array.isArray(artifact.bullets)
          ) {
            return res.status(400).json({ error: "Task artifact is invalid" });
          }
        } catch {
          return res.status(400).json({ error: "Task artifact is invalid" });
        }

        enqueueAutomationJob(db as any, {
          workspaceId: req.workspaceId,
          source: "manual.retry",
          action: "task.automation.retry",
          payload: { taskId },
        });

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "task.automation.retry_requested",
          resource: "tasks",
          details: { taskId, mode: "queued" },
        });

        return res.json({ success: true, queued: true });
      } catch {
        return res.status(500).json({ error: "Failed to queue automation retry" });
      }
    },
  );

  app.patch("/api/workspaces/:workspaceId/tasks/:taskId", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const taskId = req.params.taskId;
      const { status, error } = getAllowedTaskStatusUpdate(req.body);
      if (error || !status) {
        return res.status(400).json({ error: error || "Invalid task status" });
      }

      await db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND workspace_id = ?").run(status, taskId, req.workspaceId);
      writeAuditLog({
        workspaceId: req.workspaceId,
        userId: req.userId,
        action: "task.status_updated",
        resource: "tasks",
        details: { taskId, status },
      });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.post(
    "/api/workspaces/:workspaceId/tasks/:taskId/promote-artifact",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const taskId = req.params.taskId;
        const leadId = Number.parseInt(String(req.body?.leadId), 10);

        if (!Number.isInteger(leadId)) {
          return res.status(400).json({ error: "Valid leadId is required" });
        }

        const task = await db.prepare(`
            SELECT t.id, t.title, t.artifact_payload, a.name as assignee_name
            FROM tasks t
            LEFT JOIN agents a ON a.id = t.assignee_id AND a.workspace_id = t.workspace_id
            WHERE t.id = ? AND t.workspace_id = ?
          `).get(taskId, req.workspaceId) as
          | { id: string; title: string; artifact_payload: string | null; assignee_name: string | null }
          | undefined;

        if (!task) {
          return res.status(404).json({ error: "Task not found" });
        }

        if (!task.artifact_payload) {
          return res.status(400).json({ error: "Task has no artifact to promote" });
        }

        let artifact: { title: string; body: string; bullets: string[]; imageUrl?: string };

        try {
          artifact = JSON.parse(task.artifact_payload) as { title: string; body: string; bullets: string[]; imageUrl?: string };
        } catch {
          return res.status(500).json({ error: "Task artifact could not be read" });
        }

        if (!artifact || !isNonEmptyString(artifact.title) || !isNonEmptyString(artifact.body) || !Array.isArray(artifact.bullets) || (artifact.imageUrl !== undefined && !isNonEmptyString(artifact.imageUrl))) {
          return res.status(500).json({ error: "Task artifact is invalid" });
        }

        const lead = await db.prepare("SELECT id, notes FROM leads WHERE id = ? AND workspace_id = ?").get(leadId, req.workspaceId) as { id: number; notes: string | null } | undefined;

        if (!lead) {
          return res.status(404).json({ error: "Lead not found" });
        }

        const noteBlock = formatArtifactAsLeadNote({
          artifact,
          taskTitle: task.title,
          assigneeName: task.assignee_name ?? undefined,
        });
        const timestamp = new Date().toISOString();
        const appendedNotes = [lead.notes?.trim(), `[${timestamp}]\n${noteBlock}`]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join("\n\n");

        await db.prepare("UPDATE leads SET notes = ? WHERE id = ? AND workspace_id = ?").run(appendedNotes, leadId, req.workspaceId);

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "task.artifact.promoted_to_lead",
          resource: "leads",
          details: { taskId, leadId },
        });

        return res.json({ success: true, leadId, notes: appendedNotes });
      } catch {
        return res.status(500).json({ error: "Failed to promote task artifact" });
      }
    },
  );

  app.get("/api/workspaces/:id/messages", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { agentId } = req.query;
      let rows: any[];
      if (agentId) {
        rows = await db.prepare("SELECT * FROM messages WHERE workspace_id = ? AND agent_id = ? ORDER BY timestamp ASC").all(req.workspaceId, agentId as string);
      } else {
        rows = await db.prepare("SELECT * FROM messages WHERE workspace_id = ? ORDER BY timestamp ASC").all(req.workspaceId);
      }
      const messages = rows.map((m) => ({
        id: m.id,
        agentId: m.agent_id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        content: m.content,
        imageUrl: m.image_url,
        timestamp: m.timestamp,
        type: m.type,
      }));
      res.json(messages);
    } catch {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.delete("/api/workspaces/:id/agents/:agentId/messages", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      await db.prepare("DELETE FROM messages WHERE workspace_id = ? AND agent_id = ?").run(req.workspaceId, req.params.agentId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to clear agent message history" });
    }
  });

  app.post("/api/workspaces/:id/messages", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const { value, error } = getAllowedMessageCreate(req.body);
      if (error || !value) {
        return res.status(400).json({ error: error || "Invalid message payload" });
      }

      const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}:${req.workspaceId}`;
      await db.prepare("INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(msgId, req.workspaceId, value.agentId, value.senderId, value.senderName, value.senderAvatar, value.content, value.imageUrl, value.timestamp, value.type);
      res.json({ id: msgId });
    } catch {
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  app.get("/api/workspaces/:id/media", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const media = await db.prepare("SELECT id, name, type, category, thumbnail, size, author, created_at FROM media_assets WHERE workspace_id = ? ORDER BY created_at DESC, id DESC").all(req.workspaceId) as any[];
      
      const mappedMedia = await Promise.all(media.map(async (m) => ({
        ...m,
        thumbnail: await getSignedUrlForGcs(m.thumbnail)
      })));
        
      return res.json(mappedMedia);
    } catch {
      return res.status(500).json({ error: "Failed to fetch media assets" });
    }
  });

  app.post("/api/workspaces/:id/media", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const type = typeof req.body?.type === "string" ? req.body.type.trim().toLowerCase() : "image";
      const category = typeof req.body?.category === "string" ? req.body.category.trim().toLowerCase() : "uploads";
      let thumbnail = typeof req.body?.thumbnail === "string" ? req.body.thumbnail.trim() : "";
      const size = typeof req.body?.size === "string" ? req.body.size.trim() : null;
      const author = typeof req.body?.author === "string" ? req.body.author.trim() : null;

      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }

      if (!thumbnail || !isLikelyImageValue(thumbnail)) {
        return res.status(400).json({ error: "thumbnail must be a data:image or public http(s) URL" });
      }

      if (!["image", "video", "file"].includes(type)) {
        return res.status(400).json({ error: "Unsupported media type" });
      }

      if (!["uploads", "generated"].includes(category)) {
        return res.status(400).json({ error: "Unsupported media category" });
      }

      if (thumbnail.startsWith("data:image/")) {
        thumbnail = await uploadBase64ToGCS(thumbnail, req.workspaceId);
      }

      const result = await db.prepare("INSERT INTO media_assets (workspace_id, name, type, category, thumbnail, size, author) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id").get(req.workspaceId, name, type, category, thumbnail, size, author) as any;

      const created: any = await db.prepare("SELECT id, name, type, category, thumbnail, size, author, created_at FROM media_assets WHERE id = ? AND workspace_id = ?").get(result.id, req.workspaceId);

      if (created) {
        created.thumbnail = await getSignedUrlForGcs(created.thumbnail);
      }

      writeAuditLog({
        workspaceId: req.workspaceId,
        userId: req.userId,
        action: "media.created",
        resource: "media_assets",
        details: { mediaId: result.id, type, category },
      });

      return res.json(created);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to create media asset" });
    }
  });

  app.delete(
    "/api/workspaces/:workspaceId/media/:mediaId",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const mediaId = Number.parseInt(req.params.mediaId, 10);
        if (!Number.isInteger(mediaId)) {
          return res.status(400).json({ error: "Invalid media id" });
        }

        const targetAsset = await db.prepare("SELECT thumbnail FROM media_assets WHERE id = ? AND workspace_id = ?").get(mediaId, req.workspaceId) as any;
        if (!targetAsset) {
          return res.status(404).json({ error: "Media asset not found" });
        }

        await db.prepare("UPDATE tasks SET selected_media_asset_id = NULL WHERE workspace_id = ? AND selected_media_asset_id = ?").run(
          req.workspaceId,
          mediaId,
        );
        const result = await db.prepare("DELETE FROM media_assets WHERE id = ? AND workspace_id = ?").run(mediaId, req.workspaceId);

        if (targetAsset.thumbnail && targetAsset.thumbnail.startsWith('gcs://')) {
          void deleteGCSFile(targetAsset.thumbnail);
        }

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "media.deleted",
          resource: "media_assets",
          details: { mediaId },
        });

        return res.json({ success: true });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Failed to delete media asset" });
      }
    },
  );

  app.get("/api/workspaces/:id/automation-settings", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const row = await db.prepare(`SELECT linkedin_mode, buffer_mode, teams_mode, notion_mode, buffer_profile_id, notion_parent_page_id, require_artifact_image,
        approval_mode_linkedin, approval_mode_buffer
        FROM workspace_automation_settings WHERE workspace_id = ?`).get(req.workspaceId) as
        | {
            linkedin_mode: string;
            buffer_mode: string;
            teams_mode: string;
            notion_mode: string;
            buffer_profile_id: string | null;
            notion_parent_page_id: string | null;
            require_artifact_image: number;
            approval_mode_linkedin: string | null;
            approval_mode_buffer: string | null;
          }
        | undefined;

      return res.json({
        linkedinMode: row?.linkedin_mode || "off",
        bufferMode: row?.buffer_mode || "off",
        teamsMode: row?.teams_mode || "off",
        notionMode: row?.notion_mode || "off",
        bufferProfileId: row?.buffer_profile_id || null,
        notionParentPageId: row?.notion_parent_page_id || null,
        requireArtifactImage: Boolean(row?.require_artifact_image),
        approvalModeLinkedin: row?.approval_mode_linkedin === "approval" ? "approval" : "auto",
        approvalModeBuffer: row?.approval_mode_buffer === "approval" ? "approval" : "auto",
      });
    } catch {
      return res.status(500).json({ error: "Failed to fetch automation settings" });
    }
  });

  app.put(
    "/api/workspaces/:id/automation-settings",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
      try {
        const linkedinMode = typeof req.body?.linkedinMode === "string" ? req.body.linkedinMode.trim().toLowerCase() : "off";
        const bufferMode = typeof req.body?.bufferMode === "string" ? req.body.bufferMode.trim().toLowerCase() : "off";
        const teamsMode = typeof req.body?.teamsMode === "string" ? req.body.teamsMode.trim().toLowerCase() : "off";
        const notionMode = typeof req.body?.notionMode === "string" ? req.body.notionMode.trim().toLowerCase() : "off";
        const bufferProfileId = typeof req.body?.bufferProfileId === "string" && req.body.bufferProfileId.trim()
          ? req.body.bufferProfileId.trim()
          : null;
        const notionParentPageId = typeof req.body?.notionParentPageId === "string" && req.body.notionParentPageId.trim()
          ? req.body.notionParentPageId.trim()
          : null;
        const requireArtifactImage = Boolean(req.body?.requireArtifactImage);
        const approvalModeLinkedin = req.body?.approvalModeLinkedin === "approval" ? "approval" : "auto";
        const approvalModeBuffer = req.body?.approvalModeBuffer === "approval" ? "approval" : "auto";

        if (!["off", "publish"].includes(linkedinMode)) {
          return res.status(400).json({ error: "linkedinMode must be off or publish" });
        }

        if (!["off", "queue"].includes(bufferMode)) {
          return res.status(400).json({ error: "bufferMode must be off or queue" });
        }

        if (!["off", "send"].includes(teamsMode)) {
          return res.status(400).json({ error: "teamsMode must be off or send" });
        }

        if (!["off", "create"].includes(notionMode)) {
          return res.status(400).json({ error: "notionMode must be off or create" });
        }

        await db.prepare(`
          INSERT INTO workspace_automation_settings (workspace_id, linkedin_mode, buffer_mode, teams_mode, notion_mode, buffer_profile_id, notion_parent_page_id, require_artifact_image, approval_mode_linkedin, approval_mode_buffer, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            linkedin_mode = excluded.linkedin_mode,
            buffer_mode = excluded.buffer_mode,
            teams_mode = excluded.teams_mode,
            notion_mode = excluded.notion_mode,
            buffer_profile_id = excluded.buffer_profile_id,
            notion_parent_page_id = excluded.notion_parent_page_id,
            require_artifact_image = excluded.require_artifact_image,
            approval_mode_linkedin = excluded.approval_mode_linkedin,
            approval_mode_buffer = excluded.approval_mode_buffer,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, linkedinMode, bufferMode, teamsMode, notionMode, bufferProfileId, notionParentPageId, requireArtifactImage ? 1 : 0, approvalModeLinkedin, approvalModeBuffer);

        writeAuditLog({
          workspaceId: req.workspaceId,
          userId: req.userId,
          action: "workspace.automation.updated",
          resource: "workspace_automation_settings",
          details: { linkedinMode, bufferMode, teamsMode, notionMode, bufferProfileId, notionParentPageId, requireArtifactImage, approvalModeLinkedin, approvalModeBuffer },
        });

        return res.json({
          linkedinMode,
          bufferMode,
          teamsMode,
          notionMode,
          bufferProfileId,
          notionParentPageId,
          requireArtifactImage,
          approvalModeLinkedin,
          approvalModeBuffer,
        });
      } catch {
        return res.status(500).json({ error: "Failed to update automation settings" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/health", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const linkedin = await db.prepare("SELECT workspace_id FROM linkedin_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const buffer = await db.prepare("SELECT workspace_id FROM buffer_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const wordpress = await db.prepare("SELECT workspace_id FROM wordpress_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const hubspot = await db.prepare("SELECT workspace_id FROM hubspot_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const teams = await db.prepare("SELECT workspace_id FROM teams_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const notion = await db.prepare("SELECT workspace_id FROM notion_connections WHERE workspace_id = ?").get(req.workspaceId) as { workspace_id: number } | undefined;
      const automationSettings = await db.prepare("SELECT linkedin_mode, buffer_mode, teams_mode, notion_mode, require_artifact_image FROM workspace_automation_settings WHERE workspace_id = ?").get(req.workspaceId) as
        | { linkedin_mode: string; buffer_mode: string; teams_mode: string; notion_mode: string; require_artifact_image: number }
        | undefined;

      const failureRows = await db.prepare(`
        SELECT id, action, details, created_at
        FROM audit_logs
        WHERE workspace_id = ? AND action LIKE 'task.automation.%.failed'
        ORDER BY id DESC
        LIMIT 20
      `).all(req.workspaceId) as Array<{ id: number; action: string; details: string | null; created_at: string | null }>;

      const recentAutomationFailures = failureRows
        .map((row) => {
          let details: Record<string, unknown> | null = null;
          if (row.details) {
            try {
              details = JSON.parse(row.details) as Record<string, unknown>;
            } catch {
              details = null;
            }
          }

          return {
            id: row.id,
            action: row.action,
            taskId: typeof details?.taskId === "string" ? details.taskId : null,
            channel: typeof details?.channel === "string" ? details.channel : null,
            error: typeof details?.error === "string" ? details.error : null,
            createdAt: row.created_at,
          };
        })
        .slice(0, 8);

      const providerTelemetry = {
        linkedin: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
        buffer: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
        wordpress: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
        hubspot: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
        teams: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
        notion: { rateLimited24h: 0, authErrors24h: 0, lastError: null as string | null },
      };

      for (const failure of recentAutomationFailures) {
        const channel = failure.channel;
        if (channel !== "linkedin" && channel !== "buffer" && channel !== "wordpress" && channel !== "hubspot" && channel !== "teams" && channel !== "notion") {
          continue;
        }

        const target = providerTelemetry[channel];
        const error = (failure.error || "").toLowerCase();
        if (!target.lastError && failure.error) {
          target.lastError = failure.error;
        }
        if (error.includes("rate") || error.includes("429")) {
          target.rateLimited24h += 1;
        }
        if (error.includes("auth") || error.includes("401") || error.includes("403") || error.includes("token")) {
          target.authErrors24h += 1;
        }
      }

      const queueRows = await db.prepare(`
        SELECT status, COUNT(*) as count
        FROM automation_jobs
        WHERE workspace_id = ?
        GROUP BY status
      `).all(req.workspaceId) as Array<{ status: string; count: number }>;

      const queue = {
        queued: 0,
        running: 0,
        retrying: 0,
        deadLettered: 0,
        deduped24h: 0,
      };

      for (const row of queueRows) {
        if (row.status === "queued") queue.queued = row.count;
        if (row.status === "running") queue.running = row.count;
        if (row.status === "retrying") queue.retrying = row.count;
        if (row.status === "dead_lettered") queue.deadLettered = row.count;
      }

      const deduped24hRow = await db.prepare(`
        SELECT COUNT(*) as count
        FROM audit_logs
        WHERE workspace_id = ?
          AND action = 'task.automation.job.deduped'
          AND datetime(created_at) >= datetime('now', '-1 day')
      `).get(req.workspaceId) as { count: number } | undefined;
      queue.deduped24h = deduped24hRow?.count || 0;

      const automationRows = await db.prepare(`
        SELECT action, details, created_at
        FROM audit_logs
        WHERE workspace_id = ? AND action LIKE 'task.automation.%'
        ORDER BY created_at DESC
        LIMIT 500
      `).all(req.workspaceId) as Array<{ action: string; details: string | null; created_at: string | null }>;

      const parseAuditTimestamp = (value: string | null) => {
        if (!value) return null;
        const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
        const parsed = Date.parse(normalized);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
        const fallback = Date.parse(value);
        return Number.isFinite(fallback) ? fallback : null;
      };

      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const services = {
        linkedin: {
          connected: Boolean(linkedin),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
        buffer: {
          connected: Boolean(buffer),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
        wordpress: {
          connected: Boolean(wordpress),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
        hubspot: {
          connected: Boolean(hubspot),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
        teams: {
          connected: Boolean(teams),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
        notion: {
          connected: Boolean(notion),
          lastSuccessAt: null as string | null,
          lastFailureAt: null as string | null,
          failedCount24h: 0,
        },
      };

      const resolveChannel = (action: string, details: Record<string, unknown> | null) => {
        const detailChannel = typeof details?.channel === "string" ? details.channel : null;
        if (detailChannel === "linkedin" || detailChannel === "buffer" || detailChannel === "wordpress" || detailChannel === "hubspot" || detailChannel === "teams" || detailChannel === "notion") {
          return detailChannel;
        }
        if (action.includes("linkedin")) return "linkedin";
        if (action.includes("buffer")) return "buffer";
        if (action.includes("wordpress")) return "wordpress";
        if (action.includes("hubspot")) return "hubspot";
        if (action.includes("teams")) return "teams";
        if (action.includes("notion")) return "notion";
        return null;
      };

      for (const row of automationRows) {
        let details: Record<string, unknown> | null = null;
        if (row.details) {
          try {
            details = JSON.parse(row.details) as Record<string, unknown>;
          } catch {
            details = null;
          }
        }

        const channel = resolveChannel(row.action, details);
        if (!channel) continue;

        const rowTime = parseAuditTimestamp(row.created_at);
        const target = services[channel as keyof typeof services];

        if (row.action.endsWith(".succeeded") && !target.lastSuccessAt) {
          target.lastSuccessAt = row.created_at;
        }

        if (row.action.endsWith(".failed")) {
          if (!target.lastFailureAt) {
            target.lastFailureAt = row.created_at;
          }
          if (rowTime && rowTime >= cutoff) {
            target.failedCount24h += 1;
          }
        }
      }

      return res.json({
        services,
        providerTelemetry,
        queue,
        automation: {
          linkedinMode: automationSettings?.linkedin_mode || "off",
          bufferMode: automationSettings?.buffer_mode || "off",
          teamsMode: automationSettings?.teams_mode || "off",
          notionMode: automationSettings?.notion_mode || "off",
          requireArtifactImage: Boolean(automationSettings?.require_artifact_image),
          recentFailures: recentAutomationFailures,
        },
      });
    } catch {
      return res.status(500).json({ error: "Failed to fetch integrations health" });
    }
  });

  // =========================================================================
  // KNOWLEDGE DOCUMENTS API
  // =========================================================================

  app.get("/api/workspaces/:id/knowledge", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const rows = await db.prepare("SELECT id, title, content, author, created_at, updated_at FROM knowledge_documents WHERE workspace_id = ? ORDER BY updated_at DESC").all(req.workspaceId);
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch knowledge documents" });
    }
  });

  app.post("/api/workspaces/:id/knowledge", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const { title, content, author } = req.body;
      if (!title || !content) return res.status(400).json({ error: "Title and content are required" });
      const docId = `doc-${Date.now()}`;
      await db.prepare("INSERT INTO knowledge_documents (id, workspace_id, title, content, author) VALUES (?, ?, ?, ?, ?)").run(docId, req.workspaceId, title, content, author || "System");
      res.status(201).json({ id: docId, title, content, author });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create knowledge document" });
    }
  });

  app.patch("/api/workspaces/:id/knowledge/:docId", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      const { title, content } = req.body;
      const updates: string[] = [];
      const values: any[] = [];
      if (title) { updates.push("title = ?"); values.push(title); }
      if (content) { updates.push("content = ?"); values.push(content); }
      if (updates.length > 0) {
        updates.push("updated_at = CURRENT_TIMESTAMP");
        values.push(req.params.docId, req.workspaceId);
        await db.prepare(`UPDATE knowledge_documents SET ${updates.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...values);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  app.delete("/api/workspaces/:id/knowledge/:docId", requireAuth, requireWorkspaceAccess, requireWorkspaceRole("owner", "admin"), async (req: AuthenticatedRequest, res) => {
    try {
      await db.prepare("DELETE FROM knowledge_documents WHERE id = ? AND workspace_id = ?").run(req.params.docId, req.workspaceId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

}
