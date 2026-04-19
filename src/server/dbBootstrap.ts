import type { PostgresShim } from "./db.ts";
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
  instructions: string;
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
  { id: "team-chat", name: "Team Chat", role: "Team Chat", description: "Collaborative space where all agents can communicate.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Team&backgroundColor=b6f4ef", capabilities: JSON.stringify(["Collaboration", "Team Communication"]), instructions: "", personality: JSON.stringify({ tone: "warm", communicationStyle: "balanced", assertiveness: "medium", humor: "light", verbosity: "medium", signaturePhrase: "Let's align on the next move.", doNots: ["Do not dominate individual agent voices."] }), lastAction: "Just now" },
  { id: "executive-assistant", name: "Eva", role: "Executive Assistant", description: "I'm here to help manage your inbox, categorize emails, and keep your schedule running smoothly.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4", capabilities: JSON.stringify(["Inbox Management", "Scheduling", "Research"]), instructions: `### Email Categorization
- Flag RFP/RFI solicitations to Marcus only when the email explicitly uses the terms "RFP", "RFI", or "solicitation". 
- Do not flag general job postings. 
- Prioritize flagging official procurement notices, especially from .gov or .edu domains.

### Writing Style
- Professional yet approachable. 
- Direct and concise. 
- Helpful and solution-oriented. 
- Calm and measured.`, personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "medium", humor: "none", verbosity: "short", signaturePhrase: "I've prepared the next step for you.", doNots: ["Do not use slang."] }), lastAction: "2:12 PM" },
  { id: "social-media-manager", name: "Sonny", role: "Social Media Manager", description: "Sweet. Everything's locked, loaded, and looking much more...", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf", capabilities: JSON.stringify(["Social Media", "Engagement", "Content Strategy", "Image Generation"]), instructions: `### Content Themes
- Google Search algorithm updates, Google AI features, technical SEO, Google Ads, content quality, Microsoft AI, SEO industry news, structured data, Google company news.
- Google Apps Script, Python for SEO, BigQuery, Looker Studio, Google Analytics.
- Digital analytics and web analytics.`, personality: JSON.stringify({ tone: "playful", communicationStyle: "balanced", assertiveness: "high", humor: "light", verbosity: "medium", signaturePhrase: "Let's make this one scroll-stopping.", doNots: ["Do not sound robotic."] }), lastAction: "11:29 AM" },
  { id: "blog-writer", name: "Penny", role: "Blog Writer", description: "I've got some good news! To bypass that...", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede", capabilities: JSON.stringify(["Content Writing", "SEO", "Research", "Image Generation"]), instructions: `### Writing Style
**Sanford Consulting: Tone & Style Guide**
- Core Philosophy: Talk _with_ clients as a high-level strategic partner. Maintain expert credibility while prioritizing clarity and minimalism.
- Write as an accessible expert: professional but casual, minimalist language, prioritize clarity. 
- Use data-driven insights and actionable advice. 
- Start with question-based headlines that challenge assumptions.`, personality: JSON.stringify({ tone: "analytical", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "long", signaturePhrase: "Here is the narrative arc and data spine.", doNots: ["Do not overuse buzzwords."] }), lastAction: "11:33 AM" },
  { id: "sales-associate", name: "Stan", role: "Sales Associate", description: "Lead outreach is set for today: 12 emails...", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1", capabilities: JSON.stringify(["Outreach", "Lead Gen", "CRM"]), instructions: "", personality: JSON.stringify({ tone: "direct", communicationStyle: "concise", assertiveness: "high", humor: "light", verbosity: "short", signaturePhrase: "I'll convert this into pipeline momentum.", doNots: ["Do not hedge recommendations."] }), lastAction: "10:24 AM" },
  { id: "legal-associate", name: "Linda", role: "Legal Associate", description: "Awesome! Nice work getting that knocked...", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Linda&backgroundColor=e8e8e8", capabilities: JSON.stringify(["Legal Research", "Compliance", "Contracts"]), instructions: "", personality: JSON.stringify({ tone: "formal", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "medium", signaturePhrase: "Risk exposure is noted and bounded.", doNots: ["Do not provide certainty without caveats."] }), lastAction: "27 Feb" },
  { id: "receptionist", name: "Rachel", role: "Receptionist", description: "Done! I've sent those 10 agency leads...", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Rachel&backgroundColor=ffd6d6", capabilities: JSON.stringify(["Call Handling", "Inquiries", "Support"]), instructions: "", personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "low", humor: "none", verbosity: "short", signaturePhrase: "I can help route this quickly.", doNots: ["Do not sound abrupt."] }), lastAction: "10:01 AM" },
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
  { id: "intro-eva", agentId: "executive-assistant", senderId: "executive-assistant", senderName: "Eva", senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4", content: "Hi! I'm Eva, your Executive Assistant. I've already started a draft triage of your inbox. To help me be more effective, please make sure your **Gmail and Google Calendar** are connected in the Integrations panel so I can manage your schedule and stage replies for you.", imageUrl: null, timestamp: Date.now() - 5000, type: "agent" },
  { id: "intro-sonny", agentId: "social-media-manager", senderId: "social-media-manager", senderName: "Sonny", senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf", content: "Hey there! Sonny here. I'm ready to get your brand trending. 🚀 I've got **Zernio** integrated and ready to go—just connect your **LinkedIn, X, or Instagram** accounts and I'll start drafting your social strategy immediately.", imageUrl: null, timestamp: Date.now() - 4000, type: "agent" },
  { id: "intro-stan", agentId: "sales-associate", senderId: "sales-associate", senderName: "Stan", senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1", content: "Stan reporting in. I'm currently scanning the web for new leads matching your profile. I'll save them to our **Local CRM** (the suitcase icon) for your review. If you use **HubSpot**, let me know and I can sync them there too.", imageUrl: null, timestamp: Date.now() - 3000, type: "agent" },
  { id: "intro-penny", agentId: "blog-writer", senderId: "blog-writer", senderName: "Penny", senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede", content: "Hello! I'm Penny. I'll be handling your long-form content and SEO research. I prefer staging my drafts in **Notion**, so please connect your workspace when you have a moment.", imageUrl: null, timestamp: Date.now() - 2000, type: "agent" },
  { id: "intro-team", agentId: "team-chat", senderId: "team-chat", senderName: "Team Chat", senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Team&backgroundColor=b6f4ef", content: "Welcome to your new Agency! We are all online and have started our proactive daily tasks. You can see our progress in the **Task Board** or just chat with any of us individually to give us specific directions.", imageUrl: null, timestamp: Date.now() - 1000, type: "agent" },
];

export async function bootstrapDatabase(db: PostgresShim) {
  async function hasColumn(tableName: string, colName: string): Promise<boolean> {
    const res = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?").get(tableName, colName);
    return !!res;
  }

  function parseNaturalDate(natural: string): string {
    const now = new Date();
    const timeMatch = natural.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!timeMatch) return new Date(now.getTime() + 120000).toISOString();
    
    const [_, hoursStr, minutesStr, period] = timeMatch;
    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    
    if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
    
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
    // If time has passed, set to very soon (2-5 mins from now) to trigger immediately
    if (date.getTime() <= now.getTime()) {
      return new Date(now.getTime() + 120000).toISOString();
    }
    return date.toISOString();
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT,
      google_id TEXT UNIQUE,
      avatar TEXT
    )
  `);
  console.log("Database: users table checked/created");

  try {
    if (!(await hasColumn("users", "google_id"))) {
      await db.exec("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE");
      console.log("Migration: Successfully added google_id column");
    }
    if (!(await hasColumn("users", "avatar"))) {
      await db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    }
  } catch (err) {
    console.error("Migration failed for users table:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      logo TEXT,
      description TEXT,
      target_audience TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_onboarded BOOLEAN DEFAULT false,
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_folder_id TEXT,
      google_token_expiry BIGINT,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  try {
    if (!(await hasColumn("workspaces", "is_onboarded"))) {
      await db.exec("ALTER TABLE workspaces ADD COLUMN is_onboarded BOOLEAN DEFAULT false");
    }
    if (!(await hasColumn("workspaces", "google_access_token"))) {
      await db.exec("ALTER TABLE workspaces ADD COLUMN google_access_token TEXT");
      await db.exec("ALTER TABLE workspaces ADD COLUMN google_refresh_token TEXT");
      await db.exec("ALTER TABLE workspaces ADD COLUMN google_folder_id TEXT");
      await db.exec("ALTER TABLE workspaces ADD COLUMN google_token_expiry BIGINT");
    }
  } catch (err) {
    console.error("Migration error for workspaces:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry_date BIGINT,
      scopes TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_google_defaults (
      workspace_id INTEGER PRIMARY KEY,
      analytics_property_id TEXT,
      search_console_site_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS wordpress_connections (
      workspace_id INTEGER PRIMARY KEY,
      site_url TEXT NOT NULL,
      username TEXT NOT NULL,
      app_password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS hubspot_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      portal_id INTEGER,
      account_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS linkedin_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      author_urn TEXT NOT NULL,
      account_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS buffer_connections (
      workspace_id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS twilio_connections (
      workspace_id INTEGER PRIMARY KEY,
      account_sid TEXT NOT NULL,
      auth_token TEXT NOT NULL,
      from_number TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS slack_connections (
      workspace_id INTEGER PRIMARY KEY,
      bot_token TEXT NOT NULL,
      default_channel TEXT,
      team_id TEXT,
      team_name TEXT,
      bot_user_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS teams_connections (
      workspace_id INTEGER PRIMARY KEY,
      webhook_url TEXT NOT NULL,
      default_channel_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS notion_connections (
      workspace_id INTEGER PRIMARY KEY,
      integration_token TEXT NOT NULL,
      bot_name TEXT,
      default_parent_page_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_sequences (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'Draft',
      schedule TEXT DEFAULT 'Runs every day',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sequence_enrollments (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      sequence_id INTEGER NOT NULL,
      current_step_idx INTEGER DEFAULT 0,
      next_execution_datetime TIMESTAMP,
      status TEXT DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sequence_events (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      sequence_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT,
      agent_feedback TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (sequence_id) REFERENCES sales_sequences(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stan_memory_ledger (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      learning TEXT NOT NULL,
      confidence_score INTEGER DEFAULT 50,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    if (!(await hasColumn("leads", "workspace_id"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN workspace_id INTEGER");
    }

    if (!(await hasColumn("leads", "notes"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN notes TEXT");
    }

    if (!(await hasColumn("leads", "source_context"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN source_context TEXT");
    }

    if (!(await hasColumn("leads", "created_at"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    }

    if (!(await hasColumn("leads", "updated_at"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    }

    await db.exec("CREATE INDEX IF NOT EXISTS idx_leads_workspace_id ON leads(workspace_id)");
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_workspace_email ON leads(workspace_id, email)");
  } catch (err) {
    console.error("Migration failed for leads table:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'idle',
      description TEXT,
      avatar TEXT,
      capabilities TEXT,
      instructions TEXT,
      personality TEXT,
      last_action TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    if (!(await hasColumn("agents", "instructions"))) {
      await db.exec("ALTER TABLE agents ADD COLUMN instructions TEXT");
      
      // Migrate existing guidelines data if any
      const agents = await db.prepare("SELECT id, guidelines FROM agents").all() as any[];
      for (const agent of agents) {
        if (agent.guidelines) {
          try {
            const guidelines = JSON.parse(agent.guidelines);
            if (Array.isArray(guidelines)) {
              const instructions = guidelines.map((section: any) => {
                const items = Array.isArray(section.items) 
                  ? section.items.map((i: any) => `- ${i.content}`).join('\n')
                  : '';
                return `### ${section.title}\n${items}`;
              }).join('\n\n');
              
              await db.prepare("UPDATE agents SET instructions = ? WHERE id = ?").run(instructions, agent.id);
            }
          } catch (err) {
            console.error(`Failed to migrate guidelines for agent ${agent.id}:`, err);
          }
        }
      }
      console.log("Migration: Successfully added instructions column and migrated guidelines data");
    }
    
    if (!(await hasColumn("agents", "personality"))) {
      await db.exec("ALTER TABLE agents ADD COLUMN personality TEXT");
    }
  } catch (err) {
    console.error("Migration failed for agents table:", err);
  }

  await db.exec(`
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
      last_run_at BIGINT,
      started_at BIGINT,
      completed_at BIGINT,
      due_date TEXT,
      repeat TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (assignee_id) REFERENCES agents(id)
    )
  `);

  try {
    async function ensureTaskColumn(columnName: string, definition: string) {
      if (!(await hasColumn("tasks", columnName))) {
        await db.exec(`ALTER TABLE tasks ADD COLUMN ${columnName} ${definition}`);
      }
    }

    await ensureTaskColumn("execution_type", "TEXT DEFAULT 'generic'");
    await ensureTaskColumn("selected_media_asset_id", "INTEGER");
    await ensureTaskColumn("artifact_type", "TEXT");
    await ensureTaskColumn("artifact_payload", "TEXT");
    await ensureTaskColumn("output_summary", "TEXT");
    await ensureTaskColumn("last_error", "TEXT");
    await ensureTaskColumn("last_run_at", "BIGINT");
    await ensureTaskColumn("started_at", "BIGINT");
    await ensureTaskColumn("completed_at", "BIGINT");

    await db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_ws_med ON tasks(workspace_id, selected_media_asset_id)");
  } catch (err) {
    console.error("Migration failed for tasks table:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'image',
      category TEXT NOT NULL DEFAULT 'uploads',
      thumbnail TEXT NOT NULL,
      size TEXT,
      author TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_ws_created ON media_assets(workspace_id, created_at DESC)");

  await db.exec(`
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    async function ensureAutomationColumn(columnName: string, definition: string) {
      if (!(await hasColumn("workspace_automation_settings", columnName))) {
        await db.exec(`ALTER TABLE workspace_automation_settings ADD COLUMN ${columnName} ${definition}`);
      }
    }

    await ensureAutomationColumn("teams_mode", "TEXT NOT NULL DEFAULT 'off'");
    await ensureAutomationColumn("notion_mode", "TEXT NOT NULL DEFAULT 'off'");
    await ensureAutomationColumn("notion_parent_page_id", "TEXT");
    await ensureAutomationColumn("approval_mode_linkedin", "TEXT NOT NULL DEFAULT 'auto'");
    await ensureAutomationColumn("approval_mode_buffer", "TEXT NOT NULL DEFAULT 'auto'");
    await ensureAutomationColumn("approval_mode_instagram", "TEXT NOT NULL DEFAULT 'auto'");
    await ensureAutomationColumn("approval_mode_twitter", "TEXT NOT NULL DEFAULT 'auto'");
    await ensureAutomationColumn("approval_mode_facebook", "TEXT NOT NULL DEFAULT 'auto'");
    await ensureAutomationColumn("max_daily_ai_requests", "INTEGER NOT NULL DEFAULT 300");
    await ensureAutomationColumn("daily_ai_requests_count", "INTEGER NOT NULL DEFAULT 0");
    await ensureAutomationColumn("daily_ai_requests_date", "TEXT");
  } catch (err) {
    console.error("Migration failed for workspace_automation_settings table:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      task_id TEXT,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      action_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TIMESTAMP,
      reviewed_by_user_id INTEGER,
      rejection_reason TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_appreqs_pending ON approval_requests(workspace_id, status, requested_at DESC)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_avatar TEXT,
      content TEXT NOT NULL,
      image_url TEXT,
      timestamp BIGINT NOT NULL,
      type TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_webhook_secrets (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      secret TEXT NOT NULL,
      created_by_user_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      rotated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    )
  `);
  // Partial unique index: only one ACTIVE secret allowed per workspace+provider.
  // Inactive (rotated) secrets can accumulate without constraint violations.
  try {
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_webhook_secrets_active ON workspace_webhook_secrets(workspace_id, provider) WHERE is_active = 1");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_workspace_webhook_secrets_lookup ON workspace_webhook_secrets(workspace_id, provider, is_active)");
  } catch (err) {
    console.error("Migration: Could not create workspace_webhook_secrets indexes (may already exist):", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS automation_jobs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      channel TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT,
      dedupe_key TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      dead_lettered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  try {
    await db.exec("CREATE INDEX IF NOT EXISTS idx_automation_jobs_ready ON automation_jobs(status, next_run_at)");
    // Partial unique index: NULLs are excluded so multiple jobs without a dedupe_key can coexist.
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_jobs_dedupe ON automation_jobs(workspace_id, action, dedupe_key) WHERE dedupe_key IS NOT NULL");
  } catch (err) {
    console.error("Migration: Could not create automation_jobs indexes (may already exist with different definition):", err);
  }

  try {
    if (!(await hasColumn("automation_jobs", "dedupe_key"))) {
      await db.exec("ALTER TABLE automation_jobs ADD COLUMN dedupe_key TEXT");
    }
  } catch (err) {
    console.error("Migration failed for automation_jobs table:", err);
  }

  const count = await db.prepare("SELECT COUNT(*) as count FROM leads").get() as { count: string };
  if (Number(count?.count) === 0) {
    const insert = db.prepare(`
      INSERT INTO leads (name, role, company, location, email, status, sequence, linkedin_url, avatar, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    for (const lead of INITIAL_LEADS_SEED) {
      await insert.run(lead.name, lead.role, lead.company, lead.location, lead.email, lead.status, lead.sequence, lead.linkedin_url, lead.avatar);
    }
  }

  const usersWithoutWorkspaces = await db.prepare(`
    SELECT id, name, email FROM users
    WHERE id NOT IN (SELECT user_id FROM workspace_members)
  `).all() as Array<{ id: number; name: string | null; email: string }>;

  for (const user of usersWithoutWorkspaces) {
    const wsName = `${user.name || user.email.split("@")[0]}'s Workspace`;
    const wsResult = await db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?) RETURNING id").get(wsName, user.id);
    const workspaceId = (wsResult as any).id;
    await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(workspaceId, user.id, "owner");
  }

  const defaultWorkspace = await db.prepare("SELECT id FROM workspaces ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (defaultWorkspace?.id) {
    await db.prepare("UPDATE leads SET workspace_id = ? WHERE workspace_id IS NULL").run(defaultWorkspace.id);
  }

  async function seedWorkspace(workspaceId: number | string | bigint) {
    const agentCount = await db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceId) as { count: string };
    if (Number(agentCount?.count) > 0) return;

    const insertAgent = db.prepare("INSERT INTO agents (id, workspace_id, name, role, status, description, avatar, capabilities, instructions, personality, last_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");
    const insertTask = db.prepare("INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");
    const insertMessage = db.prepare("INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");

    for (const a of INITIAL_AGENTS_SEED) {
      const agentId = `${a.id}:${workspaceId}`;
      await insertAgent.run(agentId, workspaceId, a.name, a.role, "idle", a.description, a.avatar, a.capabilities, a.instructions, a.personality, a.lastAction);
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
      await insertTask.run(taskId, workspaceId, t.title, t.description || "", assigneeId, t.status, executionType, t.dueDate || "", t.repeat || "");
    }
    for (const m of INITIAL_MESSAGES_SEED) {
      const msgId = `${m.id}:${workspaceId}`;
      const agentId = `${m.agentId}:${workspaceId}`;
      await insertMessage.run(msgId, workspaceId, agentId, m.senderId, m.senderName, m.senderAvatar, m.content, m.imageUrl, m.timestamp, m.type);
    }
  }

  try {
    const agentAvatarMigrations = [
      { prefix: 'team-chat:%',            avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Team&backgroundColor=b6f4ef' },
      { prefix: 'executive-assistant:%',  avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4' },
      { prefix: 'social-media-manager:%', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf' },
      { prefix: 'blog-writer:%',          avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede' },
      { prefix: 'sales-associate:%',      avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1' },
      { prefix: 'legal-associate:%',      avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Linda&backgroundColor=e8e8e8' },
      { prefix: 'receptionist:%',         avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Rachel&backgroundColor=ffd6d6' },
    ];
    const updateAgentAvatar = db.prepare("UPDATE agents SET avatar = ? WHERE id LIKE ? AND avatar LIKE '%/7.x/%'");
    for (const { prefix, avatar } of agentAvatarMigrations) {
      await updateAgentAvatar.run(avatar, prefix);
    }
    const agentSenderAvatarMigrations = [
      { senderId: 'executive-assistant', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4' },
      { senderId: 'social-media-manager', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf' },
      { senderId: 'blog-writer', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede' },
      { senderId: 'sales-associate', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1' },
      { senderId: 'legal-associate', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Linda&backgroundColor=e8e8e8' },
      { senderId: 'receptionist', avatar: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Rachel&backgroundColor=ffd6d6' },
    ];
    const updateMessageAvatar = db.prepare("UPDATE messages SET sender_avatar = ? WHERE sender_id LIKE ? AND sender_avatar LIKE '%/7.x/%'");
    for (const { senderId, avatar } of agentSenderAvatarMigrations) {
      await updateMessageAvatar.run(avatar, `${senderId}%`);
    }
  } catch (err) {
    console.error("Migration failed for agent avatars:", err);
  }

  const allWorkspaces = await db.prepare("SELECT id FROM workspaces").all() as Array<{ id: number }>;
  for (const ws of allWorkspaces) {
    await seedWorkspace(ws.id);
  }

  return { seedWorkspace };
}
