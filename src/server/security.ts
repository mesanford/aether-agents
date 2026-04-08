import express from "express";
import jwt from "jsonwebtoken";
import type { AuthenticatedRequest } from "./types.ts";

import type { PostgresShim } from "./db.ts";

type DatabaseLike = PostgresShim;

type RateLimiterConfig = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

export function createSecurityTools(db: DatabaseLike, jwtSecret: string) {
  function getUserIdFromRequest(req: express.Request): number | null {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return null;
      const decoded = jwt.verify(authHeader.split(" ")[1], jwtSecret) as { userId?: number };
      return typeof decoded.userId === "number" ? decoded.userId : null;
    } catch {
      return null;
    }
  }

  function requireAuth(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.userId = userId;
    next();
  }

  async function requireWorkspaceAccess(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
    try {
      const rawWorkspaceId = req.params.workspaceId || req.params.id;
      const workspaceId = Number.parseInt(rawWorkspaceId, 10);

      if (!Number.isInteger(workspaceId)) {
        return res.status(400).json({ error: "Invalid workspace id" });
      }

      const membership = await db.prepare(
        "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
      ).get(workspaceId, req.userId) as { role: string } | undefined;

      if (!membership) {
        return res.status(403).json({ error: "Forbidden" });
      }

      req.workspaceId = workspaceId;
      req.workspaceRole = membership.role;
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireWorkspaceRole(...allowedRoles: string[]) {
    return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
      if (!req.workspaceRole || !allowedRoles.includes(req.workspaceRole)) {
        return res.status(403).json({ error: "Insufficient workspace permissions" });
      }
      next();
    };
  }

  function createRateLimiter(config: RateLimiterConfig) {
    const bucket = new Map<string, { count: number; resetAt: number }>();

    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const userId = getUserIdFromRequest(req);
      const identity = userId ? `user:${userId}` : `ip:${req.ip}`;
      const key = `${config.keyPrefix}:${identity}`;
      const now = Date.now();

      const current = bucket.get(key);
      if (!current || now > current.resetAt) {
        bucket.set(key, { count: 1, resetAt: now + config.windowMs });
        return next();
      }

      if (current.count >= config.max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.setHeader("Retry-After", retryAfterSeconds.toString());
        return res.status(429).json({ error: "Too many requests" });
      }

      current.count += 1;
      return next();
    };
  }

  return {
    getUserIdFromRequest,
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole,
    createRateLimiter,
  };
}
