import Database from "better-sqlite3";
import { inferTaskExecutionType } from "./taskExecution.ts";

type SeedLead = {
  name: string;
  role: string;
  company: string;
  location: string;
  email: string;
  status: string;
  sequence: string;
  linkedin_url?: string;
  avatar: string;
};

type SeedAgent = {
  id: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  capabilities: string;
  guidelines: string;
  personality: string;
  lastAction: string;
};

type SeedTask = {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  status: string;
  dueDate: string;
  repeat: string;
};

type SeedMessage = {
  id: string;
  agentId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  content: string;
  imageUrl: string | null;
  timestamp: number;
  type: string;
};

const INITIAL_LEADS_SEED: SeedLead[] = [
  { name: "Ryan Dietz", role: "Director, Analytics", company: "Annalect", location: "Savannah, GA, US", email: "ryan.dietz@annalect.com", status: "New Lead", sequence: "None", linkedin_url: "https://linkedin.com/in/ryandietz", avatar: "RD" },
  { name: "Puviarasan Sivananth...", role: "Analytics Lead", company: "Aeropay", location: "Chicago, IL, US", email: "puviarasan.sivanantham@...", status: "New Lead", sequence: "None", linkedin_url: "https://linkedin.com/in/puviarasan", avatar: "PS" },
  { name: "Morgan Harris", role: "President and Manag...", company: "Acacia Consulting Group", location: "Chicago, IL, US", email: "morgan@teamacacia.com", status: "Contacted", sequence: "Sanford Consulting", avatar: "MH" },
  { name: "Gary Mack", role: "President", company: "Mack Communications Inc", location: "Chicago, IL, US", email: "gary@mackcommunication...", status: "Contacted", sequence: "Sanford Consulting", avatar: "GM" },
  { name: "Lissa Druss", role: "CEO", company: "Strategia Consulting", location: "United States", email: "lissadruss@riothg.com", status: "Contacted", sequence: "Sanford Consulting", avatar: "LD" },
  { name: "Nathan Michael", role: "Founder", company: "Nathan Michael Design", location: "Chicago, IL, US", email: "nm@nathanmichaeldesign....", status: "Contacted", sequence: "Sanford Consulting", avatar: "NM" },
  { name: "Tim Westerbeck", role: "President", company: "Eduvantis", location: "Chicago, IL, US", email: "tim@eduvantis.com", status: "Contacted", sequence: "Sanford Consulting", avatar: "TW" },
  { name: "Emily Hartzog", role: "President", company: "Chartwell Agency", location: "Rockford, IL, US", email: "ehartzog@chartwell-agenc...", status: "Contacted", sequence: "Sanford Consulting", avatar: "EH" },
  { name: "Scott Miles", role: "Principal", company: "Atypikal", location: "Chicago, IL, US", email: "scott.miles@atypikal.co", status: "Contacted", sequence: "Sanford Consulting", avatar: "SM" },
  { name: "Marshall Krakauer", role: "Sermo", company: "Sermo", location: "", email: "marshall.krakauer@sermo....", status: "Contacted", sequence: "Sanford Consulting", avatar: "MK" },
];

const INITIAL_AGENTS_SEED: SeedAgent[] = [
  { id: "team-chat", name: "Team Chat", role: "Team Chat", description: "Collaborative space where all agents can communicate.", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Team&gender=male", capabilities: JSON.stringify(["Collaboration", "Team Communication"]), guidelines: JSON.stringify([]), personality: JSON.stringify({ tone: "warm", communicationStyle: "balanced", assertiveness: "medium", humor: "light", verbosity: "medium", signaturePhrase: "Let's align on the next move.", doNots: ["Do not dominate individual agent voices."] }), lastAction: "Just now" },
  { id: "executive-assistant", name: "Eva", role: "Executive Assistant", description: "I'm here to help manage your inbox, categorize emails, and keep your schedule running smoothly.", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female", capabilities: JSON.stringify(["Inbox Management", "Scheduling", "Research"]), guidelines: JSON.stringify([{ id: "1", title: "Any specific rules to help me categorize your emails better?", items: [{ id: "1", content: "Flag RFP/RFI solicitations to Marcus only when the email explicitly uses the terms \"RFP\", \"RFI\", or \"solicitation\". Do not flag general job postings. Prioritize flagging official procurement notices, especially from .gov or .edu domains." }], showInput: true }, { id: "2", title: "How should I write emails?", items: [{ id: "1", content: "Professional yet approachable. Direct and concise. Helpful and solution-oriented. Calm and measured.", isMarkdown: false }], showInput: false }]), personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "medium", humor: "none", verbosity: "short", signaturePhrase: "I've prepared the next step for you.", doNots: ["Do not use slang."] }), lastAction: "2:12 PM" },
  { id: "social-media-manager", name: "Sonny", role: "Social Media Manager", description: "Sweet. Everything's locked, loaded, and looking much more...", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male", capabilities: JSON.stringify(["Social Media", "Engagement", "Content Strategy", "Image Generation"]), guidelines: JSON.stringify([{ id: "1", title: "Content Themes", items: [{ id: "1", content: "Google Search algorithm updates, Google AI features, technical SEO, Google Ads, content quality, Microsoft AI, SEO industry news, structured data, Google company news." }, { id: "2", content: "Google Apps Script, Python for SEO, BigQuery, Looker Studio, Google Analytics." }, { id: "3", content: "Digital analytics and web analytics." }], showInput: false }]), personality: JSON.stringify({ tone: "playful", communicationStyle: "balanced", assertiveness: "high", humor: "light", verbosity: "medium", signaturePhrase: "Let's make this one scroll-stopping.", doNots: ["Do not sound robotic."] }), lastAction: "11:29 AM" },
  { id: "blog-writer", name: "Penny", role: "Blog Writer", description: "I've got some good news! To bypass that...", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female", capabilities: JSON.stringify(["Content Writing", "SEO", "Research", "Image Generation"]), guidelines: JSON.stringify([{ id: "1", title: "Writing Style", items: [{ id: "1", content: "**Sanford Consulting: Tone & Style Guide**\n\nCore Philosophy: Talk _with_ clients as a high-level strategic partner. Maintain expert credibility while prioritizing clarity and minimalism.", isMarkdown: true }, { id: "2", content: "Write as an accessible expert: professional but casual, minimalist language, prioritize clarity. Use data-driven insights and actionable advice. Start with question-based headlines that challenge assumptions.", isMarkdown: false }], showInput: true }]), personality: JSON.stringify({ tone: "analytical", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "long", signaturePhrase: "Here is the narrative arc and data spine.", doNots: ["Do not overuse buzzwords."] }), lastAction: "11:33 AM" },
  { id: "sales-associate", name: "Stan", role: "Sales Associate", description: "Lead outreach is set for today: 12 emails...", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Stan&gender=male", capabilities: JSON.stringify(["Outreach", "Lead Gen", "CRM"]), guidelines: JSON.stringify([]), personality: JSON.stringify({ tone: "direct", communicationStyle: "concise", assertiveness: "high", humor: "light", verbosity: "short", signaturePhrase: "I'll convert this into pipeline momentum.", doNots: ["Do not hedge recommendations."] }), lastAction: "10:24 AM" },
  { id: "legal-associate", name: "Linda", role: "Legal Associate", description: "Awesome! Nice work getting that knocked...", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Linda&gender=female", capabilities: JSON.stringify(["Legal Research", "Compliance", "Contracts"]), guidelines: JSON.stringify([]), personality: JSON.stringify({ tone: "formal", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "medium", signaturePhrase: "Risk exposure is noted and bounded.", doNots: ["Do not provide certainty without caveats."] }), lastAction: "27 Feb" },
  { id: "receptionist", name: "Rachel", role: "Receptionist", description: "Done! I've sent those 10 agency leads...", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Rachel&gender=female", capabilities: JSON.stringify(["Call Handling", "Inquiries", "Support"]), guidelines: JSON.stringify([]), personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "low", humor: "none", verbosity: "short", signaturePhrase: "I can help route this quickly.", doNots: ["Do not sound abrupt."] }), lastAction: "10:01 AM" },
];

const INITIAL_TASKS_SEED: SeedTask[] = [
  { id: "proactive-ea", title: "Proactive: Daily Inbox & Schedule Triage", description: "Review incoming emails, flag important solicitations, and organize the daily schedule.", assigneeId: "executive-assistant", status: "todo", dueDate: "Today, 8:00 AM", repeat: "Every day" },
  { id: "proactive-smm", title: "Proactive: Social Media Research & Engagement", description: "Research new social post ideas, engage with followers, and monitor industry trends.", assigneeId: "social-media-manager", status: "todo", dueDate: "Today, 8:30 AM", repeat: "Every day" },
  { id: "proactive-bw", title: "Proactive: Content Research & Ideation", description: "Research new blog post topics, gather data-driven insights, and outline upcoming articles.", assigneeId: "blog-writer", status: "todo", dueDate: "Today, 9:00 AM", repeat: "Every day" },
  { id: "proactive-sa", title: "Proactive: Lead Generation & Outreach", description: "Find new leads for the company, draft outreach emails, and follow up with potential clients.", assigneeId: "sales-associate", status: "todo", dueDate: "Today, 9:30 AM", repeat: "Every day" },
  { id: "proactive-la", title: "Proactive: Compliance & Contract Review", description: "Review recent legal updates, check compliance status, and monitor contract renewals.", assigneeId: "legal-associate", status: "todo", dueDate: "Today, 10:00 AM", repeat: "Every day" },
  { id: "proactive-r", title: "Proactive: User Feedback & Inquiry Management", description: "Collect user feedback, review customer inquiries, and organize support tickets.", assigneeId: "receptionist", status: "todo", dueDate: "Today, 10:30 AM", repeat: "Every day" },
  { id: "task-1", title: "Daily Engagement", description: "Help me move my social media forward. Take initiative by alternating your actions based on what you see fit.", assigneeId: "social-media-manager", status: "todo", dueDate: "Tomorrow, 9:00 AM", repeat: "Every day" },
  { id: "task-2", title: "Daily Lead Generation for Stan", description: "Research 5-10 marketing agency leads in Illinois (Higher Ed, Gov, B2B branding) to act as potential clients.", assigneeId: "receptionist", status: "todo", dueDate: "Tomorrow, 9:00 AM", repeat: "Every day" },
  { id: "task-8", title: "Draft 5 Blog Posts for March", description: "Create detailed outlines and first drafts for 5 technical SEO blog posts.", assigneeId: "blog-writer", status: "done", dueDate: "Feb 25, 2026", repeat: "" },
  { id: "task-9", title: "Reschedule 15 Social Media Posts", description: "Update images and reschedule 15 posts to match the new brand aesthetic.", assigneeId: "social-media-manager", status: "done", dueDate: "Feb 26, 2026", repeat: "" },
  { id: "task-10", title: "Research 20 leads for GovCon", description: "Find 20 new leads in the government contracting space.", assigneeId: "sales-associate", status: "done", dueDate: "Feb 27, 2026", repeat: "" },
];

const INITIAL_MESSAGES_SEED: SeedMessage[] = [
  { id: "smm-1", agentId: "social-media-manager", senderId: "user", senderName: "Marcus Sanford", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=marcus", content: "Sonny, please recreate the images for all scheduled and draft blog posts to fit our brand look and feel, just like you did for the \"Higher ed has an Innovation Paradox\" post.", imageUrl: null, timestamp: Date.now() - 1000000, type: "user" },
  { id: "smm-2", agentId: "social-media-manager", senderId: "social-media-manager", senderName: "Sonny", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male", content: "I've been working through the queue to get every single post matched up with that clean MM Sanford aesthetic.\n\n**Here's where we're at:**\n\n* I've unscheduled and updated the images for **15 posts** to that minimalist, light-beige and Sanford Orange look.\n* I've also successfully rescheduled those new versions back to their original slots in March.\n\nShould I keep going and finish off the last few?", imageUrl: null, timestamp: Date.now() - 500000, type: "agent" },
  { id: "smm-3", agentId: "social-media-manager", senderId: "user", senderName: "Marcus Sanford", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=marcus", content: "yes", imageUrl: null, timestamp: Date.now() - 100000, type: "user" },
  { id: "smm-4", agentId: "social-media-manager", senderId: "social-media-manager", senderName: "Sonny", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male", content: "Sweet. Everything's locked, loaded, and looking much more \"Sanford\" now. 🎨\n\nSince the March calendar is officially a masterpiece, do you want me to keep the momentum going on the April queue, or are we taking a breather? ☕", imageUrl: null, timestamp: Date.now() - 50000, type: "agent" },
  { id: "tc-1", agentId: "team-chat", senderId: "executive-assistant", senderName: "Eva", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female", content: "Hi team! I've set up this space for us to collaborate on the Sanford project. @Sonny, how is the brand glow-up coming along?", imageUrl: null, timestamp: Date.now() - 2000000, type: "agent" },
  { id: "tc-2", agentId: "team-chat", senderId: "social-media-manager", senderName: "Sonny", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male", content: "It's going great, Eva! Just finished the March calendar. @Penny, I might need some help with the April blog post visuals once you have the drafts ready.", imageUrl: null, timestamp: Date.now() - 1500000, type: "agent" },
  { id: "tc-3", agentId: "team-chat", senderId: "blog-writer", senderName: "Penny", senderAvatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female", content: "On it, Sonny! I'll have the first batch of April drafts to you by tomorrow EOD.", imageUrl: null, timestamp: Date.now() - 1000000, type: "agent" },
];

export function bootstrapDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT,
      google_id TEXT UNIQUE,
      avatar TEXT
    )
  `);
  console.log("Database: users table checked/created");

  try {
    const columns = db.prepare("PRAGMA table_info(users)").all() as any[];
    const hasGoogleId = columns.some((col) => col.name === "google_id");
    if (!hasGoogleId) {
      console.log("Migration: google_id column missing, adding it now...");
      db.exec("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE");
      console.log("Migration: Successfully added google_id column");
    }
    const hasAvatar = columns.some((col) => col.name === "avatar");
    if (!hasAvatar) {
      db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    }
  } catch (err) {
    console.error("Migration failed for users table:", err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      logo TEXT,
      description TEXT,
      target_audience TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_onboarded BOOLEAN DEFAULT 0,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  try {
    const columns = db.prepare("PRAGMA table_info(workspaces)").all() as any[];
    const hasIsOnboarded = columns.some((col) => col.name === "is_onboarded");
    if (!hasIsOnboarded) {
      console.log("Migration: is_onboarded column missing on workspaces, adding it now...");
      db.exec("ALTER TABLE workspaces ADD COLUMN is_onboarded BOOLEAN DEFAULT 0");
    }
  } catch (err) {
    console.error("Migration error for workspaces is_onboarded:", err);
  }

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

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
    CREATE TABLE IF NOT EXISTS workspace_google_defaults (
      workspace_id INTEGER PRIMARY KEY,
      analytics_property_id TEXT,
      search_console_site_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS wordpress_connections (
      workspace_id INTEGER PRIMARY KEY,
      site_url TEXT NOT NULL,
      username TEXT NOT NULL,
      app_password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hubspot_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      portal_id INTEGER,
      account_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS linkedin_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      author_urn TEXT NOT NULL,
      account_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS buffer_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS twilio_connections (
      workspace_id INTEGER PRIMARY KEY,
      account_sid TEXT NOT NULL,
      auth_token TEXT NOT NULL,
      from_number TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS slack_connections (
      workspace_id INTEGER PRIMARY KEY,
      bot_token TEXT NOT NULL,
      default_channel TEXT,
      team_id TEXT,
      team_name TEXT,
      bot_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS teams_connections (
      workspace_id INTEGER PRIMARY KEY,
      webhook_url TEXT NOT NULL,
      default_channel_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS notion_connections (
      workspace_id INTEGER PRIMARY KEY,
      integration_token TEXT NOT NULL,
      bot_name TEXT,
      default_parent_page_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
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
      notes TEXT,
      linkedin_url TEXT,
      avatar TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'Draft',
      schedule TEXT DEFAULT 'Runs every day',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      sequence_id INTEGER NOT NULL,
      current_step_idx INTEGER DEFAULT 0,
      next_execution_datetime DATETIME,
      status TEXT DEFAULT 'Active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sequence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      sequence_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT,
      agent_feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stan_memory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      learning TEXT NOT NULL,
      confidence_score INTEGER DEFAULT 50,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    const leadColumns = db.prepare("PRAGMA table_info(leads)").all() as any[];
    const hasWorkspaceId = leadColumns.some((col) => col.name === "workspace_id");
    const hasNotes = leadColumns.some((col) => col.name === "notes");

    if (!hasWorkspaceId) {
      db.exec("ALTER TABLE leads ADD COLUMN workspace_id INTEGER");
    }

    if (!hasNotes) {
      db.exec("ALTER TABLE leads ADD COLUMN notes TEXT");
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_leads_workspace_id ON leads(workspace_id)");
  } catch (err) {
    console.error("Migration failed for leads table:", err);
  }

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
      personality TEXT,
      last_action TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
    if (!agentColumns.some((column) => column.name === "personality")) {
      db.exec("ALTER TABLE agents ADD COLUMN personality TEXT");
    }
  } catch (err) {
    console.error("Migration failed for agents table:", err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id TEXT NOT NULL,
      status TEXT DEFAULT 'todo',
      execution_type TEXT DEFAULT 'generic',
      selected_media_asset_id INTEGER,
      artifact_type TEXT,
      artifact_payload TEXT,
      output_summary TEXT,
      last_error TEXT,
      last_run_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      due_date TEXT,
      repeat TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (assignee_id) REFERENCES agents(id)
    )
  `);

  try {
    const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const ensureTaskColumn = (columnName: string, definition: string) => {
      if (!taskColumns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE tasks ADD COLUMN ${columnName} ${definition}`);
      }
    };

    ensureTaskColumn("execution_type", "TEXT DEFAULT 'generic'");
    ensureTaskColumn("selected_media_asset_id", "INTEGER");
    ensureTaskColumn("artifact_type", "TEXT");
    ensureTaskColumn("artifact_payload", "TEXT");
    ensureTaskColumn("output_summary", "TEXT");
    ensureTaskColumn("last_error", "TEXT");
    ensureTaskColumn("last_run_at", "INTEGER");
    ensureTaskColumn("started_at", "INTEGER");
    ensureTaskColumn("completed_at", "INTEGER");

    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_workspace_selected_media ON tasks(workspace_id, selected_media_asset_id)");
  } catch (err) {
    console.error("Migration failed for tasks table:", err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'image',
      category TEXT NOT NULL DEFAULT 'uploads',
      thumbnail TEXT NOT NULL,
      size TEXT,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_workspace_created ON media_assets(workspace_id, created_at DESC)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_automation_settings (
      workspace_id INTEGER PRIMARY KEY,
      linkedin_mode TEXT NOT NULL DEFAULT 'off',
      buffer_mode TEXT NOT NULL DEFAULT 'off',
      teams_mode TEXT NOT NULL DEFAULT 'off',
      notion_mode TEXT NOT NULL DEFAULT 'off',
      buffer_profile_id TEXT,
      notion_parent_page_id TEXT,
      require_artifact_image INTEGER NOT NULL DEFAULT 0,
      max_daily_ai_requests INTEGER NOT NULL DEFAULT 300,
      daily_ai_requests_count INTEGER NOT NULL DEFAULT 0,
      daily_ai_requests_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    const automationColumns = db.prepare("PRAGMA table_info(workspace_automation_settings)").all() as Array<{ name: string }>;
    const ensureAutomationColumn = (columnName: string, definition: string) => {
      if (!automationColumns.some((column) => column.name === columnName)) {
        db.exec(`ALTER TABLE workspace_automation_settings ADD COLUMN ${columnName} ${definition}`);
      }
    };

    ensureAutomationColumn("teams_mode", "TEXT NOT NULL DEFAULT 'off'");
    ensureAutomationColumn("notion_mode", "TEXT NOT NULL DEFAULT 'off'");
    ensureAutomationColumn("notion_parent_page_id", "TEXT");
    ensureAutomationColumn("approval_mode_linkedin", "TEXT NOT NULL DEFAULT 'auto'");
    ensureAutomationColumn("approval_mode_buffer", "TEXT NOT NULL DEFAULT 'auto'");
    ensureAutomationColumn("approval_mode_instagram", "TEXT NOT NULL DEFAULT 'auto'");
    ensureAutomationColumn("approval_mode_twitter", "TEXT NOT NULL DEFAULT 'auto'");
    ensureAutomationColumn("approval_mode_facebook", "TEXT NOT NULL DEFAULT 'auto'");
    ensureAutomationColumn("max_daily_ai_requests", "INTEGER NOT NULL DEFAULT 300");
    ensureAutomationColumn("daily_ai_requests_count", "INTEGER NOT NULL DEFAULT 0");
    ensureAutomationColumn("daily_ai_requests_date", "TEXT");
  } catch (err) {
    console.error("Migration failed for workspace_automation_settings table:", err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      action_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by_user_id INTEGER,
      rejection_reason TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_approval_requests_pending ON approval_requests(workspace_id, status, requested_at DESC)");

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_webhook_secrets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      secret TEXT NOT NULL,
      created_by_user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rotated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      UNIQUE(workspace_id, provider, is_active)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_workspace_webhook_secrets_lookup ON workspace_webhook_secrets(workspace_id, provider, is_active)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS automation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      channel TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT,
      dedupe_key TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      dead_lettered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_automation_jobs_ready ON automation_jobs(status, next_run_at)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_jobs_dedupe ON automation_jobs(workspace_id, action, dedupe_key) WHERE dedupe_key IS NOT NULL");

  try {
    const automationJobColumns = db.prepare("PRAGMA table_info(automation_jobs)").all() as Array<{ name: string }>;
    if (!automationJobColumns.some((column) => column.name === "dedupe_key")) {
      db.exec("ALTER TABLE automation_jobs ADD COLUMN dedupe_key TEXT");
    }
  } catch (err) {
    console.error("Migration failed for automation_jobs table:", err);
  }

  const count = db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: number };
  if (count.count === 0) {
    const insert = db.prepare(`
      INSERT INTO leads (name, role, company, location, email, status, sequence, linkedin_url, avatar, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    INITIAL_LEADS_SEED.forEach((lead) => {
      insert.run(lead.name, lead.role, lead.company, lead.location, lead.email, lead.status, lead.sequence, lead.linkedin_url, lead.avatar);
    });
  }

  const usersWithoutWorkspaces = db.prepare(`
    SELECT id, name, email FROM users
    WHERE id NOT IN (SELECT user_id FROM workspace_members)
  `).all() as Array<{ id: number; name: string | null; email: string }>;

  usersWithoutWorkspaces.forEach((user) => {
    const wsName = `${user.name || user.email.split("@")[0]}'s Workspace`;
    const wsResult = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run(wsName, user.id);
    const workspaceId = wsResult.lastInsertRowid;
    db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, "owner");
  });

  const defaultWorkspace = db.prepare("SELECT id FROM workspaces ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (defaultWorkspace?.id) {
    db.prepare("UPDATE leads SET workspace_id = ? WHERE workspace_id IS NULL").run(defaultWorkspace.id);
  }

  function seedWorkspace(workspaceId: number | bigint) {
    const agentCount = db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceId) as { count: number };
    if (agentCount.count > 0) return;

    const insertAgent = db.prepare("INSERT OR IGNORE INTO agents (id, workspace_id, name, role, status, description, avatar, capabilities, guidelines, personality, last_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertTask = db.prepare("INSERT OR IGNORE INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertMessage = db.prepare("INSERT OR IGNORE INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    for (const a of INITIAL_AGENTS_SEED) {
      const agentId = `${a.id}:${workspaceId}`;
      insertAgent.run(agentId, workspaceId, a.name, a.role, "idle", a.description, a.avatar, a.capabilities, a.guidelines, a.personality, a.lastAction);
    }
    for (const t of INITIAL_TASKS_SEED) {
      const taskId = `${t.id}:${workspaceId}`;
      const assigneeId = `${t.assigneeId}:${workspaceId}`;
      const seedAgent = INITIAL_AGENTS_SEED.find((agent) => agent.id === t.assigneeId);
      const executionType = inferTaskExecutionType({
        taskTitle: t.title,
        taskDescription: t.description,
        agentRole: seedAgent?.role,
      });
      insertTask.run(taskId, workspaceId, t.title, t.description || "", assigneeId, t.status, executionType, t.dueDate || "", t.repeat || "");
    }
    for (const m of INITIAL_MESSAGES_SEED) {
      const msgId = `${m.id}:${workspaceId}`;
      const agentId = `${m.agentId}:${workspaceId}`;
      insertMessage.run(msgId, workspaceId, agentId, m.senderId, m.senderName, m.senderAvatar, m.content, m.imageUrl, m.timestamp, m.type);
    }
  }

  const allWorkspaces = db.prepare("SELECT id FROM workspaces").all() as Array<{ id: number }>;
  for (const ws of allWorkspaces) {
    seedWorkspace(ws.id);
  }

  return { seedWorkspace };
}
