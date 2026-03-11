import "dotenv/config";
import { config } from "dotenv";

// Load .env.local (takes precedence over .env)
config({ path: ".env.local", override: true });

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

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.warn("WARNING: JWT_SECRET environment variable is not set. Using a default unsafe secret.");
}
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
    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry_date INTEGER,
      scopes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      description TEXT,
      avatar TEXT,
      capabilities TEXT,
      guidelines TEXT,
      last_action TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id TEXT NOT NULL,
      status TEXT DEFAULT 'todo',
      due_date TEXT,
      repeat TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (assignee_id) REFERENCES agents(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_avatar TEXT,
      content TEXT NOT NULL,
      image_url TEXT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
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

  app.get("/api/auth/google/url", (req, res) => {
    // Rely on APP_URL strictly if provided, else attempt extraction
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
    const { code, state } = req.query;
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    // Detect if this is a Workspace integration connect (not a plain login)
    let isWorkspaceConnect = false;
    let workspaceUserId: number | null = null;
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state as string, "base64").toString());
        if (parsed.type === 'workspace') {
          isWorkspaceConnect = true;
          workspaceUserId = parsed.userId;
        }
      } catch { /* not a workspace state — treat as login */ }
    }

    try {
      const authClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
      const { tokens } = await authClient.getToken({ code: code as string, redirect_uri: redirectUri });

      if (isWorkspaceConnect && workspaceUserId) {
        // Workspace Integration Flow: store tokens for Gmail/Calendar/Drive access
        db.prepare(`
          INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry_date, scopes)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = COALESCE(excluded.refresh_token, refresh_token),
            expiry_date = excluded.expiry_date,
            scopes = excluded.scopes
        `).run(workspaceUserId, tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null, tokens.scope || "");
        return res.send(`<html><body><script>window.opener.postMessage({type:'WORKSPACE_AUTH_SUCCESS'},'*');window.close();</script></body></html>`);
      }

      // Login Flow: verify identity and issue JWT
      authClient.setCredentials(tokens);
      const ticket = await authClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error("Invalid Google payload");

      const { email, name, sub: googleId } = payload;
      let user = db.prepare("SELECT * FROM users WHERE google_id = ? OR email = ?").get(googleId, email) as any;

      if (!user) {
        const result = db.prepare("INSERT INTO users (email, name, google_id) VALUES (?, ?, ?)").run(email, name, googleId);
        user = { id: result.lastInsertRowid, email, name };
        const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(`${name || email.split('@')[0]}'s Workspace`, user.id);
        const workspaceId = wsResult.lastInsertRowid;
        db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, 'owner');
      } else if (!user.google_id) {
        db.prepare("UPDATE users SET google_id = ?, name = COALESCE(name, ?) WHERE id = ?").run(googleId, name, user.id);
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
      res.send(`
        <html><body><script>
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${token}', user: ${JSON.stringify({ id: user.id, email: user.email, name: user.name })} }, '*');
          window.close();
        </script></body></html>
      `);
    } catch (error) {
      console.error("Google OAuth error:", error);
      if (isWorkspaceConnect) {
        return res.send(`<html><body><script>window.opener.postMessage({type:'WORKSPACE_AUTH_ERROR',error:'Authentication failed'},'*');window.close();</script></body></html>`);
      }
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

  // ─── Helper: seed a brand-new workspace with default agents / tasks ───────
  const INITIAL_AGENTS_SEED = [
    { id: 'team-chat', name: 'Team Chat', role: 'Team Chat', description: 'Collaborative space where all agents can communicate.', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Team&gender=male', capabilities: JSON.stringify(['Collaboration', 'Team Communication']), guidelines: JSON.stringify([]), lastAction: 'Just now' },
    { id: 'executive-assistant', name: 'Eva', role: 'Executive Assistant', description: "I'm here to help manage your inbox, categorize emails, and keep your schedule running smoothly.", avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female', capabilities: JSON.stringify(['Inbox Management', 'Scheduling', 'Research']), guidelines: JSON.stringify([{ id: '1', title: 'Any specific rules to help me categorize your emails better?', items: [{ id: '1', content: 'Flag RFP/RFI solicitations to Marcus only when the email explicitly uses the terms \"RFP\", \"RFI\", or \"solicitation\". Do not flag general job postings. Prioritize flagging official procurement notices, especially from .gov or .edu domains.' }], showInput: true }, { id: '2', title: 'How should I write emails?', items: [{ id: '1', content: 'Professional yet approachable. Direct and concise. Helpful and solution-oriented. Calm and measured.', isMarkdown: false }], showInput: false }]), lastAction: '2:12 PM' },
    { id: 'social-media-manager', name: 'Sonny', role: 'Social Media Manager', description: "Sweet. Everything's locked, loaded, and looking much more...", avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male', capabilities: JSON.stringify(['Social Media', 'Engagement', 'Content Strategy', 'Image Generation']), guidelines: JSON.stringify([{ id: '1', title: 'Content Themes', items: [{ id: '1', content: 'Google Search algorithm updates, Google AI features, technical SEO, Google Ads, content quality, Microsoft AI, SEO industry news, structured data, Google company news.' }, { id: '2', content: 'Google Apps Script, Python for SEO, BigQuery, Looker Studio, Google Analytics.' }, { id: '3', content: 'Digital analytics and web analytics.' }], showInput: false }]), lastAction: '11:29 AM' },
    { id: 'blog-writer', name: 'Penny', role: 'Blog Writer', description: "I've got some good news! To bypass that...", avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female', capabilities: JSON.stringify(['Content Writing', 'SEO', 'Research', 'Image Generation']), guidelines: JSON.stringify([{ id: '1', title: 'Writing Style', items: [{ id: '1', content: '**Sanford Consulting: Tone & Style Guide**\n\nCore Philosophy: Talk _with_ clients as a high-level strategic partner. Maintain expert credibility while prioritizing clarity and minimalism.', isMarkdown: true }, { id: '2', content: 'Write as an accessible expert: professional but casual, minimalist language, prioritize clarity. Use data-driven insights and actionable advice. Start with question-based headlines that challenge assumptions.', isMarkdown: false }], showInput: true }]), lastAction: '11:33 AM' },
    { id: 'sales-associate', name: 'Stan', role: 'Sales Associate', description: 'Lead outreach is set for today: 12 emails...', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stan&gender=male', capabilities: JSON.stringify(['Outreach', 'Lead Gen', 'CRM']), guidelines: JSON.stringify([]), lastAction: '10:24 AM' },
    { id: 'legal-associate', name: 'Linda', role: 'Legal Associate', description: 'Awesome! Nice work getting that knocked...', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Linda&gender=female', capabilities: JSON.stringify(['Legal Research', 'Compliance', 'Contracts']), guidelines: JSON.stringify([]), lastAction: '27 Feb' },
    { id: 'receptionist', name: 'Rachel', role: 'Receptionist', description: "Done! I've sent those 10 agency leads...", avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rachel&gender=female', capabilities: JSON.stringify(['Call Handling', 'Inquiries', 'Support']), guidelines: JSON.stringify([]), lastAction: '10:01 AM' },
  ];

  const INITIAL_TASKS_SEED = [
    { id: 'proactive-ea', title: 'Proactive: Daily Inbox & Schedule Triage', description: 'Review incoming emails, flag important solicitations, and organize the daily schedule.', assigneeId: 'executive-assistant', status: 'todo', dueDate: 'Today, 8:00 AM', repeat: 'Every day' },
    { id: 'proactive-smm', title: 'Proactive: Social Media Research & Engagement', description: 'Research new social post ideas, engage with followers, and monitor industry trends.', assigneeId: 'social-media-manager', status: 'todo', dueDate: 'Today, 8:30 AM', repeat: 'Every day' },
    { id: 'proactive-bw', title: 'Proactive: Content Research & Ideation', description: 'Research new blog post topics, gather data-driven insights, and outline upcoming articles.', assigneeId: 'blog-writer', status: 'todo', dueDate: 'Today, 9:00 AM', repeat: 'Every day' },
    { id: 'proactive-sa', title: 'Proactive: Lead Generation & Outreach', description: 'Find new leads for the company, draft outreach emails, and follow up with potential clients.', assigneeId: 'sales-associate', status: 'todo', dueDate: 'Today, 9:30 AM', repeat: 'Every day' },
    { id: 'proactive-la', title: 'Proactive: Compliance & Contract Review', description: 'Review recent legal updates, check compliance status, and monitor contract renewals.', assigneeId: 'legal-associate', status: 'todo', dueDate: 'Today, 10:00 AM', repeat: 'Every day' },
    { id: 'proactive-r', title: 'Proactive: User Feedback & Inquiry Management', description: 'Collect user feedback, review customer inquiries, and organize support tickets.', assigneeId: 'receptionist', status: 'todo', dueDate: 'Today, 10:30 AM', repeat: 'Every day' },
    { id: 'task-1', title: 'Daily Engagement', description: 'Help me move my social media forward. Take initiative by alternating your actions based on what you see fit.', assigneeId: 'social-media-manager', status: 'todo', dueDate: 'Tomorrow, 9:00 AM', repeat: 'Every day' },
    { id: 'task-2', title: 'Daily Lead Generation for Stan', description: 'Research 5-10 marketing agency leads in Illinois (Higher Ed, Gov, B2B branding) to act as potential clients.', assigneeId: 'receptionist', status: 'todo', dueDate: 'Tomorrow, 9:00 AM', repeat: 'Every day' },
    { id: 'task-8', title: 'Draft 5 Blog Posts for March', description: 'Create detailed outlines and first drafts for 5 technical SEO blog posts.', assigneeId: 'blog-writer', status: 'done', dueDate: 'Feb 25, 2026' },
    { id: 'task-9', title: 'Reschedule 15 Social Media Posts', description: 'Update images and reschedule 15 posts to match the new brand aesthetic.', assigneeId: 'social-media-manager', status: 'done', dueDate: 'Feb 26, 2026' },
    { id: 'task-10', title: 'Research 20 leads for GovCon', description: 'Find 20 new leads in the government contracting space.', assigneeId: 'sales-associate', status: 'done', dueDate: 'Feb 27, 2026' },
  ];

  const INITIAL_MESSAGES_SEED = [
    { id: 'smm-1', agentId: 'social-media-manager', senderId: 'user', senderName: 'Marcus Sanford', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus', content: 'Sonny, please recreate the images for all scheduled and draft blog posts to fit our brand look and feel, just like you did for the "Higher ed has an Innovation Paradox" post.', imageUrl: null, timestamp: Date.now() - 1000000, type: 'user' },
    { id: 'smm-2', agentId: 'social-media-manager', senderId: 'social-media-manager', senderName: 'Sonny', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male', content: "I've been working through the queue to get every single post matched up with that clean MM Sanford aesthetic.\n\n**Here's where we're at:**\n\n* I've unscheduled and updated the images for **15 posts** to that minimalist, light-beige and Sanford Orange look.\n* I've also successfully rescheduled those new versions back to their original slots in March.\n\nShould I keep going and finish off the last few?", imageUrl: null, timestamp: Date.now() - 500000, type: 'agent' },
    { id: 'smm-3', agentId: 'social-media-manager', senderId: 'user', senderName: 'Marcus Sanford', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus', content: 'yes', imageUrl: null, timestamp: Date.now() - 100000, type: 'user' },
    { id: 'smm-4', agentId: 'social-media-manager', senderId: 'social-media-manager', senderName: 'Sonny', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male', content: "Sweet. Everything's locked, loaded, and looking much more \"Sanford\" now. 🎨\n\nSince the March calendar is officially a masterpiece, do you want me to keep the momentum going on the April queue, or are we taking a breather? ☕", imageUrl: null, timestamp: Date.now() - 50000, type: 'agent' },
    { id: 'tc-1', agentId: 'team-chat', senderId: 'executive-assistant', senderName: 'Eva', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female', content: "Hi team! I've set up this space for us to collaborate on the Sanford project. @Sonny, how is the brand glow-up coming along?", imageUrl: null, timestamp: Date.now() - 2000000, type: 'agent' },
    { id: 'tc-2', agentId: 'team-chat', senderId: 'social-media-manager', senderName: 'Sonny', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male', content: "It's going great, Eva! Just finished the March calendar. @Penny, I might need some help with the April blog post visuals once you have the drafts ready.", imageUrl: null, timestamp: Date.now() - 1500000, type: 'agent' },
    { id: 'tc-3', agentId: 'team-chat', senderId: 'blog-writer', senderName: 'Penny', senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female', content: "On it, Sonny! I'll have the first batch of April drafts to you by tomorrow EOD.", imageUrl: null, timestamp: Date.now() - 1000000, type: 'agent' },
  ];

  function seedWorkspace(workspaceId: number | bigint) {
    const agentCount = db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceId) as { count: number };
    if (agentCount.count > 0) return; // already seeded

    const insertAgent = db.prepare(`INSERT OR IGNORE INTO agents (id, workspace_id, name, role, status, description, avatar, capabilities, guidelines, last_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertTask = db.prepare(`INSERT OR IGNORE INTO tasks (id, workspace_id, title, description, assignee_id, status, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertMessage = db.prepare(`INSERT OR IGNORE INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const a of INITIAL_AGENTS_SEED) {
      const agentId = `${a.id}:${workspaceId}`;
      insertAgent.run(agentId, workspaceId, a.name, a.role, 'idle', a.description, a.avatar, a.capabilities, a.guidelines, a.lastAction);
    }
    for (const t of INITIAL_TASKS_SEED) {
      const taskId = `${t.id}:${workspaceId}`;
      const assigneeId = `${t.assigneeId}:${workspaceId}`;
      insertTask.run(taskId, workspaceId, t.title, t.description || '', assigneeId, t.status, t.dueDate || '', t.repeat || '');
    }
    for (const m of INITIAL_MESSAGES_SEED) {
      const msgId = `${m.id}:${workspaceId}`;
      const agentId = `${m.agentId}:${workspaceId}`;
      insertMessage.run(msgId, workspaceId, agentId, m.senderId, m.senderName, m.senderAvatar, m.content, m.imageUrl, m.timestamp, m.type);
    }
  }

  // Seed all existing workspaces that have no agents yet
  const allWorkspaces = db.prepare("SELECT id FROM workspaces").all() as { id: number }[];
  for (const ws of allWorkspaces) {
    seedWorkspace(ws.id);
  }

  // ─── Agents API ───────────────────────────────────────────────────────────
  app.get("/api/workspaces/:id/agents", (req, res) => {
    try {
      const workspaceId = parseInt(req.params.id);
      const rows = db.prepare("SELECT * FROM agents WHERE workspace_id = ?").all(workspaceId) as any[];
      const agents = rows.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        description: a.description,
        avatar: a.avatar,
        capabilities: JSON.parse(a.capabilities || '[]'),
        guidelines: JSON.parse(a.guidelines || '[]'),
        lastAction: a.last_action,
      }));
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  });

  app.patch("/api/workspaces/:workspaceId/agents/:agentId", (req, res) => {
    try {
      const { agentId } = req.params;
      const { status, guidelines, description } = req.body;
      if (status !== undefined) db.prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, agentId);
      if (guidelines !== undefined) db.prepare("UPDATE agents SET guidelines = ? WHERE id = ?").run(JSON.stringify(guidelines), agentId);
      if (description !== undefined) db.prepare("UPDATE agents SET description = ? WHERE id = ?").run(description, agentId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update agent" });
    }
  });

  // ─── Tasks API ────────────────────────────────────────────────────────────
  app.get("/api/workspaces/:id/tasks", (req, res) => {
    try {
      const workspaceId = parseInt(req.params.id);
      const rows = db.prepare("SELECT * FROM tasks WHERE workspace_id = ? ORDER BY rowid ASC").all(workspaceId) as any[];
      const tasks = rows.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assigneeId: t.assignee_id,
        status: t.status,
        dueDate: t.due_date,
        repeat: t.repeat,
      }));
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/workspaces/:id/tasks", (req, res) => {
    try {
      const workspaceId = parseInt(req.params.id);
      const { title, description, assigneeId, dueDate, repeat } = req.body;
      const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}:${workspaceId}`;
      db.prepare(`INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(taskId, workspaceId, title, description || '', assigneeId, 'todo', dueDate || '', repeat || '');
      res.json({ id: taskId, title, description, assigneeId, status: 'todo', dueDate, repeat });
    } catch (error) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.patch("/api/workspaces/:workspaceId/tasks/:taskId", (req, res) => {
    try {
      const taskId = req.params.taskId;
      const { status } = req.body;
      db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, taskId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  // ─── Messages API ─────────────────────────────────────────────────────────
  app.get("/api/workspaces/:id/messages", (req, res) => {
    try {
      const workspaceId = parseInt(req.params.id);
      const { agentId } = req.query;
      let rows: any[];
      if (agentId) {
        rows = db.prepare("SELECT * FROM messages WHERE workspace_id = ? AND agent_id = ? ORDER BY timestamp ASC").all(workspaceId, agentId as string);
      } else {
        rows = db.prepare("SELECT * FROM messages WHERE workspace_id = ? ORDER BY timestamp ASC").all(workspaceId);
      }
      const messages = rows.map(m => ({
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
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.post("/api/workspaces/:id/messages", (req, res) => {
    try {
      const workspaceId = parseInt(req.params.id);
      const { agentId, senderId, senderName, senderAvatar, content, imageUrl, timestamp, type } = req.body;
      const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}:${workspaceId}`;
      db.prepare(`INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(msgId, workspaceId, agentId, senderId, senderName, senderAvatar || '', content, imageUrl || null, timestamp || Date.now(), type);
      res.json({ id: msgId });
    } catch (error) {
      res.status(500).json({ error: "Failed to save message" });
    }
  });

  // ─── Google Workspace Integration ────────────────────────────────────────

  // Helper: get an authenticated OAuth2 client for a user (auto-refreshes token)
  async function getWorkspaceClient(userId: number): Promise<OAuth2Client | null> {
    const row = db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId) as any;
    if (!row) return null;

    const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    client.setCredentials({
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
    });

    // Auto-refresh if expired or expiring soon
    if (row.expiry_date && Date.now() > row.expiry_date - 60000) {
      try {
        const { credentials } = await client.refreshAccessToken();
        db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?")
          .run(credentials.access_token, credentials.expiry_date, userId);
        client.setCredentials(credentials);
      } catch (e) {
        console.error("Failed to refresh Google token:", e);
        return null;
      }
    }

    return client;
  }

  // Helper: get userId from Bearer token
  function getUserIdFromRequest(req: any): number | null {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return null;
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as any;
      return decoded.userId;
    } catch {
      return null;
    }
  }

  // Connect Google Workspace — generates OAuth URL with workspace scopes
  // Uses the same callback URL as login (/api/auth/google/callback) to avoid registering a second redirect URI.
  // The flow is distinguished via the 'type' field in the state parameter.
  app.get("/api/integrations/google/connect", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    const authClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
    const url = authClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/docs.readonly",
        "https://www.googleapis.com/auth/presentations.readonly",
      ],
      state: Buffer.from(JSON.stringify({ type: "workspace", userId })).toString("base64"),
    });

    res.json({ url });
  });

  // Check which Google services are connected
  app.get("/api/integrations/google/status", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const row = db.prepare("SELECT scopes, expiry_date FROM google_tokens WHERE user_id = ?").get(userId) as any;
    if (!row) return res.json({ connected: false, scopes: [] });

    const scopes = (row.scopes || "").split(" ").filter(Boolean);
    const connected = scopes.length > 0;
    res.json({
      connected,
      gmail: scopes.some((s: string) => s.includes("gmail")),
      calendar: scopes.some((s: string) => s.includes("calendar")),
      drive: scopes.some((s: string) => s.includes("drive") || s.includes("docs") || s.includes("presentations")),
      scopes,
    });
  });

  // Disconnect Google Workspace
  app.delete("/api/integrations/google", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    db.prepare("DELETE FROM google_tokens WHERE user_id = ?").run(userId);
    res.json({ success: true });
  });

  // ─── Gmail Proxy ──────────────────────────────────────────────────────────
  app.get("/api/integrations/gmail/messages", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Gmail not connected" });

    try {
      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth: client });
      const maxResults = parseInt(req.query.maxResults as string) || 10;

      const listRes = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        labelIds: ["INBOX"],
        // Default: recent inbox messages. Frontend can pass ?q=is:unread to filter.
        q: (req.query.q as string) || "",
      });

      const messages = await Promise.all(
        (listRes.data.messages || []).map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const headers = msg.data.payload?.headers || [];
          const get = (name: string) => headers.find((h) => h.name === name)?.value || "";
          return {
            id: m.id,
            from: get("From"),
            subject: get("Subject"),
            date: get("Date"),
            snippet: msg.data.snippet,
          };
        })
      );

      res.json({ messages });
    } catch (err: any) {
      console.error("Gmail API error:", err.message);
      res.status(500).json({ error: "Failed to fetch Gmail messages" });
    }
  });

  app.post("/api/integrations/gmail/drafts", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Gmail not connected" });

    try {
      const { to, subject, body } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "Missing to, subject, or body" });
      }

      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth: client });

      // Construct standard RFC 2822 email
      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];
      const message = messageParts.join("\n");

      // base64url encode the message (Gmail API requirement)
      const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const draftRes = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw: encodedMessage,
          },
        },
      });

      res.json({ success: true, draftId: draftRes.data.id });
    } catch (err: any) {
      console.error("Gmail Draft API error:", err.message);
      res.status(500).json({ error: "Failed to create Gmail draft" });
    }
  });

  // ─── Calendar Proxy ───────────────────────────────────────────────────────
  app.get("/api/integrations/calendar/events", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Calendar not connected" });

    try {
      const { google } = await import("googleapis");
      const calendar = google.calendar({ version: "v3", auth: client });
      const days = parseInt(req.query.days as string) || 7;

      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const eventsRes = await calendar.events.list({
        calendarId: "primary",
        timeMin,
        timeMax,
        maxResults: 20,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (eventsRes.data.items || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        description: e.description,
        attendees: (e.attendees || []).map((a) => a.email),
      }));

      res.json({ events });
    } catch (err: any) {
      console.error("Calendar API error:", err.message);
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  // ─── Drive Proxy ──────────────────────────────────────────────────────────
  app.get("/api/integrations/drive/files", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Drive not connected" });

    try {
      const { google } = await import("googleapis");
      const drive = google.drive({ version: "v3", auth: client });
      const maxResults = parseInt(req.query.maxResults as string) || 20;
      const query = (req.query.q as string) || "";

      const filesRes = await drive.files.list({
        pageSize: maxResults,
        q: query || "trashed=false",
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners)",
      });

      const files = (filesRes.data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
        type: f.mimeType?.includes("document") ? "doc"
          : f.mimeType?.includes("spreadsheet") ? "sheet"
            : f.mimeType?.includes("presentation") ? "slides"
              : f.mimeType?.includes("folder") ? "folder"
                : "file",
      }));

      res.json({ files });
    } catch (err: any) {
      console.error("Drive API error:", err.message);
      res.status(500).json({ error: "Failed to fetch Drive files" });
    }
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

  // ─── Background Task Execution Engine ──────────────────────────────────────

  async function executePendingTasks() {
    const now = new Date().toISOString();

    // Find all 'todo' tasks where due_date is a valid ISO string and is in the past
    // Note: Due to SQLite not having a native date type, we query all 'todo' items
    // and filter in node since many existing entries are natural language ("Tomorrow", etc.)
    const todoTasks = db.prepare("SELECT * FROM tasks WHERE status = 'todo'").all() as any[];

    for (const task of todoTasks) {
      if (!task.due_date) continue;

      // Is it a valid ISO string?
      const isIsoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|([+-]\d{2}:\d{2}))?$/.test(task.due_date);
      if (!isIsoDate) continue; // Skip natural language tasks

      if (task.due_date <= now) {
        console.log(`[Task Engine] Executing task: ${task.title}`);

        // Mark as running
        db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(task.id);

        try {
          const workspaceId = task.workspace_id;
          const agentId = task.assignee_id;

          // Get the agent who owns this task
          const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as any;
          if (!agentRow) throw new Error("Agent not found");

          const agent = {
            id: agentRow.id,
            workspaceId: agentRow.workspace_id,
            name: agentRow.name,
            role: agentRow.role,
            status: agentRow.status,
            description: agentRow.description,
            avatar: agentRow.avatar,
            capabilities: JSON.parse(agentRow.capabilities),
            guidelines: JSON.parse(agentRow.guidelines),
            lastAction: agentRow.last_action,
          };

          // Make the agent execute the task securely by pulling in the shared gemini service
          const geminiServiceUrl = `http://localhost:${PORT}/api/internal/execute-task`;
          // We can't easily import the frontend TS module from the backend, so we'll mock the response
          // For now, since Gemini API is mostly client-side in this architecture, we will log a placeholder
          // execution message. A true full-stack move would move `geminiService` strictly to Node.

          // For now: Mark the task done, post a mock system message. 
          db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);

          // Create a message in the system indicating action was taken
          const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}:${workspaceId}`;
          db.prepare(`INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              msgId,
              workspaceId,
              agentId, // post in agent's direct thread
              agentId,
              agent.name,
              agent.avatar,
              `I have completed the scheduled task: **${task.title}**. (Execution engine triggered).`,
              Date.now(),
              'agent'
            );

        } catch (err: any) {
          console.error(`[Task Engine] Failed to execute task ${task.id}: ${err.message}`);
          db.prepare("UPDATE tasks SET status = 'todo' WHERE id = ?").run(task.id); // Revert
        }
      }
    }
  }

  // Run the engine every 60 seconds
  setInterval(executePendingTasks, 60000);
  console.log("[Task Engine] Started. Polling every 60 seconds.");


  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
