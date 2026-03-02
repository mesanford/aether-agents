import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Database initialization
  const db = new Database("crm.db");
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
