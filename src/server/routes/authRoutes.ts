import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

type DatabaseLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => any;
    run: (...args: unknown[]) => { lastInsertRowid?: number | bigint };
  };
};

type RegisterAuthRoutesArgs = {
  app: express.Application;
  db: DatabaseLike;
  jwtSecret: string;
  googleClientId?: string;
  googleClientSecret?: string;
  authRateLimiter: express.RequestHandler;
  seedWorkspace: (workspaceId: number | bigint) => void;
};

export function registerAuthRoutes({
  app,
  db,
  jwtSecret,
  googleClientId,
  googleClientSecret,
  authRateLimiter,
  seedWorkspace,
}: RegisterAuthRoutesArgs) {
  const googleClient = new OAuth2Client(googleClientId, googleClientSecret);

  app.post("/api/auth/register", authRateLimiter, async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const existingUser = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (existingUser) {
        return res.status(400).json({ error: "Email already in use" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userName = name || email.split("@")[0];
      const result = db.prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?)").run(email, hashedPassword, userName);

      const userId = result.lastInsertRowid;

      const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(`${userName}'s Workspace`, userId);
      const workspaceId = wsResult.lastInsertRowid;

      db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, userId, "owner");
      seedWorkspace(workspaceId as number | bigint);

      const token = jwt.sign({ userId }, jwtSecret, { expiresIn: "7d" });

      return res.json({ token, user: { id: userId, email, name: userName } });
    } catch (error) {
      console.error("Register error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/login", authRateLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (typeof user.password !== "string" || user.password.length === 0) {
        return res.status(401).json({ error: "This account uses Google sign-in. Please continue with Google." });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: "7d" });
      return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, jwtSecret) as any;

      const user = db.prepare("SELECT id, email, name, avatar FROM users WHERE id = ?").get(decoded.userId) as any;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      return res.json({ user });
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  app.patch("/api/auth/me", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, jwtSecret) as any;

      const { name, email, avatar } = req.body;
      const updates: string[] = [];
      const values: any[] = [];

      if (name !== undefined) { updates.push("name = ?"); values.push(name); }
      if (email !== undefined) { updates.push("email = ?"); values.push(email); }
      if (avatar !== undefined) { updates.push("avatar = ?"); values.push(avatar); }

      if (updates.length > 0) {
        values.push(decoded.userId);
        db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      }

      const updatedUser = db.prepare("SELECT id, email, name, avatar FROM users WHERE id = ?").get(decoded.userId);
      return res.json({ user: updatedUser });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.patch("/api/users/:id/password", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, jwtSecret) as any;
      if (decoded.userId.toString() !== req.params.id) {
         return res.status(403).json({ error: "Forbidden" });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ error: "Missing password fields" });

      const user = db.prepare("SELECT password FROM users WHERE id = ?").get(decoded.userId) as any;
      if (!user || typeof user.password !== "string" || user.password.length === 0) {
        return res.status(400).json({ error: "Cannot change password for this account type" });
      }

      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) return res.status(400).json({ error: "Incorrect current password" });

      const hashedNew = await bcrypt.hash(newPassword, 10);
      db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedNew, decoded.userId);

      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to update password" });
    }
  });

  app.get("/api/auth/google/url", (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const url = googleClient.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/userinfo.email"],
      redirect_uri: redirectUri,
    });
    return res.json({ url });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code, state } = req.query;
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    let isWorkspaceConnect = false;
    let workspaceUserId: number | null = null;
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state as string, "base64").toString());
        if (parsed.type === "workspace") {
          isWorkspaceConnect = true;
          workspaceUserId = parsed.userId;
        }
      } catch {
        // ignore invalid state payload
      }
    }

    try {
      const authClient = new OAuth2Client(googleClientId, googleClientSecret, redirectUri);
      const { tokens } = await authClient.getToken({ code: code as string, redirect_uri: redirectUri });

      if (isWorkspaceConnect && workspaceUserId) {
        db.prepare(`
          INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, scopes)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = COALESCE(excluded.refresh_token, refresh_token),
            expiry_date = excluded.expiry_date,
            scopes = excluded.scopes
        `).run(workspaceUserId, tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null, tokens.scope || "");
        return res.send("<html><body><script>window.opener.postMessage({type:'WORKSPACE_AUTH_SUCCESS'},'*');window.close();</script></body></html>");
      }

      authClient.setCredentials(tokens);
      const ticket = await authClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: googleClientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error("Invalid Google payload");

      const { email, name, sub: googleId } = payload;
      let user = db.prepare("SELECT * FROM users WHERE google_id = ? OR email = ?").get(googleId, email) as any;

      if (!user) {
        const result = db.prepare("INSERT INTO users (email, name, google_id) VALUES (?, ?, ?)").run(email, name, googleId);
        user = { id: result.lastInsertRowid, email, name };
        const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(`${name || email.split("@")[0]}'s Workspace`, user.id);
        const workspaceId = wsResult.lastInsertRowid;
        db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, "owner");
        seedWorkspace(workspaceId as number | bigint);
      } else if (!user.google_id) {
        db.prepare("UPDATE users SET google_id = ?, name = COALESCE(name, ?) WHERE id = ?").run(googleId, name, user.id);
      }

      const token = jwt.sign({ userId: user.id }, jwtSecret, { expiresIn: "7d" });
      return res.send(`
        <html><body><script>
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${token}', user: ${JSON.stringify({ id: user.id, email: user.email, name: user.name })} }, '*');
          window.close();
        </script></body></html>
      `);
    } catch (error) {
      console.error("Google OAuth error:", error);
      if (isWorkspaceConnect) {
        return res.send("<html><body><script>window.opener.postMessage({type:'WORKSPACE_AUTH_ERROR',error:'Authentication failed'},'*');window.close();</script></body></html>");
      }
      return res.status(500).send("Authentication failed");
    }
  });
}
