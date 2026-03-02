import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-in-production";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Database initialization
  const db = new Database("crm.db");
  
  // Ensure users table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT,
      google_id TEXT UNIQUE
    )
  `);
  console.log("Database: users table checked/created");

  // Migration: Check if google_id column exists (for older databases)
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all() as any[];
    const hasGoogleId = columns.some(col => col.name === 'google_id');
    if (!hasGoogleId) {
      console.log("Migration: google_id column missing, adding it now...");
      db.exec("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE");
      console.log("Migration: Successfully added google_id column");
    }
  } catch (err) {
    console.error("Migration failed for users table:", err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      company TEXT,
      location TEXT,
      email TEXT,
      status TEXT DEFAULT 'New Lead',
      sequence TEXT DEFAULT 'None',
      linkedin_url TEXT,
      avatar TEXT
    )
  `);

  // Seed data if empty
  const count = db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number };
  if (count.count === 0) {
    const seedLeads = [
      { name: 'Ryan Dietz', role: 'Director, Analytics', company: 'Annalect', location: 'Savannah, GA, US', email: 'ryan.dietz@annalect.com', status: 'New Lead', sequence: 'None', linkedin_url: 'https://linkedin.com/in/ryandietz', avatar: 'RD' },
      { name: 'Puviarasan Sivananth...', role: 'Analytics Lead', company: 'Aeropay', location: 'Chicago, IL, US', email: 'puviarasan.sivanantham@...', status: 'New Lead', sequence: 'None', linkedin_url: 'https://linkedin.com/in/puviarasan', avatar: 'PS' },
      { name: 'Morgan Harris', role: 'President and Manag...', company: 'Acacia Consulting Group', location: 'Chicago, IL, US', email: 'morgan@teamacacia.com', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'MH' },
      { name: 'Gary Mack', role: 'President', company: 'Mack Communications Inc', location: 'Chicago, IL, US', email: 'gary@mackcommunication...', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'GM' },
      { name: 'Lissa Druss', role: 'CEO', company: 'Strategia Consulting', location: 'United States', email: 'lissadruss@riothg.com', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'LD' },
      { name: 'Nathan Michael', role: 'Founder', company: 'Nathan Michael Design', location: 'Chicago, IL, US', email: 'nm@nathanmichaeldesign....', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'NM' },
      { name: 'Tim Westerbeck', role: 'President', company: 'Eduvantis', location: 'Chicago, IL, US', email: 'tim@eduvantis.com', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'TW' },
      { name: 'Emily Hartzog', role: 'President', company: 'Chartwell Agency', location: 'Rockford, IL, US', email: 'ehartzog@chartwell-agenc...', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'EH' },
      { name: 'Scott Miles', role: 'Principal', company: 'Atypikal', location: 'Chicago, IL, US', email: 'scott.miles@atypikal.co', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'SM' },
      { name: 'Marshall Krakauer', role: 'Sermo', company: 'Sermo', location: '', email: 'marshall.krakauer@sermo....', status: 'Contacted', sequence: 'Sanford Consulting', avatar: 'MK' }
    ];

    const insert = db.prepare(`
      INSERT INTO leads (name, role, company, location, email, status, sequence, linkedin_url, avatar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    seedLeads.forEach(lead => {
      insert.run(lead.name, lead.role, lead.company, lead.location, lead.email, lead.status, lead.sequence, lead.linkedin_url, lead.avatar);
    });
  }

  // Ensure all users have at least one workspace (Migration)
  const usersWithoutWorkspaces = db.prepare(`
    SELECT id, name, email FROM users 
    WHERE id NOT IN (SELECT user_id FROM workspace_members)
  `).all() as any[];

  usersWithoutWorkspaces.forEach(user => {
    const wsName = `${user.name || user.email.split('@')[0]}'s Workspace`;
    const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(wsName, user.id);
    const workspaceId = wsResult.lastInsertRowid;
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, 'owner');
  });

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
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
      const userName = name || email.split('@')[0];
      const result = db.prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?)").run(email, hashedPassword, userName);
      
      const userId = result.lastInsertRowid;
      
      // Create default workspace
      const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(`${userName}'s Workspace`, userId);
      const workspaceId = wsResult.lastInsertRowid;
      
      // Add user as owner of the workspace
      db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, userId, 'owner');

      const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
      
      res.json({ token, user: { id: userId, email, name: userName } });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(decoded.userId) as any;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // Google OAuth Routes
  app.get("/api/auth/google/url", (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const url = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
      redirect_uri: redirectUri
    });
    res.json({ url });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    try {
      const { tokens } = await googleClient.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      googleClient.setCredentials(tokens);

      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      
      if (!payload || !payload.email) {
        throw new Error("Invalid Google payload");
      }

      const { email, name, sub: googleId } = payload;

      let user = db.prepare("SELECT * FROM users WHERE google_id = ? OR email = ?").get(googleId, email) as any;

      if (!user) {
        const result = db.prepare("INSERT INTO users (email, name, google_id) VALUES (?, ?, ?)").run(email, name, googleId);
        user = { id: result.lastInsertRowid, email, name };
        
        // Create default workspace for Google user
        const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(`${name || email.split('@')[0]}'s Workspace`, user.id);
        const workspaceId = wsResult.lastInsertRowid;
        db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, 'owner');
      } else if (!user.google_id) {
        db.prepare("UPDATE users SET google_id = ?, name = COALESCE(name, ?) WHERE id = ?").run(googleId, name, user.id);
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS', 
                token: '${token}', 
                user: ${JSON.stringify({ id: user.id, email: user.email, name: user.name })} 
              }, '*');
              window.close();
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Workspace Routes
  app.get("/api/workspaces", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const workspaces = db.prepare(`
        SELECT w.*, wm.role 
        FROM workspaces w 
        JOIN workspace_members wm ON w.id = wm.workspace_id 
        WHERE wm.user_id = ?
      `).all(decoded.userId);
      
      res.json(workspaces);
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  app.post("/api/workspaces", (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Workspace name is required" });

      const result = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(name, decoded.userId);
      const workspaceId = result.lastInsertRowid;
      
      db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, decoded.userId, 'owner');
      
      res.json({ id: workspaceId, name, role: 'owner' });
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  app.get("/api/workspaces/:id/members", (req, res) => {
    try {
      const { id } = req.params;
      const members = db.prepare(`
        SELECT u.id, u.email, u.name, wm.role 
        FROM users u 
        JOIN workspace_members wm ON u.id = wm.user_id 
        WHERE wm.workspace_id = ?
      `).all(id);
      res.json(members);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch members" });
    }
  });

  // API Routes
  app.get("/api/leads", (req, res) => {
    const leads = db.prepare("SELECT * FROM leads ORDER BY id DESC").all();
    res.json(leads);
  });

  app.post("/api/leads", (req, res) => {
    const { name, role, company, location, email, status, sequence, linkedin_url, avatar } = req.body;
    const result = db.prepare(`
      INSERT INTO leads (name, role, company, location, email, status, sequence, linkedin_url, avatar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, role, company, location, email, status || 'New Lead', sequence || 'None', linkedin_url, avatar);
    res.json({ id: result.lastInsertRowid });
  });

  app.patch("/api/leads/:id", (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const keys = Object.keys(updates);
    const setClause = keys.map(k => `${k} = ?`).join(", ");
    const values = Object.values(updates);
    db.prepare(`UPDATE leads SET ${setClause} WHERE id = ?`).run(...values, id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
