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
  metadata?: any;
};

type SeedKnowledge = {
  id: string;
  title: string;
  content: string;
  author: string;
};

const INITIAL_KNOWLEDGE_SEED: SeedKnowledge[] = [
  {
    id: "kb-playbook",
    title: "Brand Voice & Strategy Playbook",
    author: "System",
    content: `# Brand Voice & Strategy Playbook
Update this document with your actual brand guidelines. All agents reference it before producing content.

**Tone**: [Describe your preferred tone — e.g., "Professional but approachable, direct, data-driven"]
**Brand Promise**: [Your core value proposition in one sentence]
**Target Audience**: [Who you serve and what they care about most]

**Content Guidelines**:
- [Guideline 1 — e.g., "Always lead with data and specific numbers over opinions"]
- [Guideline 2 — e.g., "Use plain language; avoid jargon unless writing for a technical audience"]
- [Guideline 3 — e.g., "Every piece of content should end with a clear next step or call to action"]

**Off-Brand Behaviors** (agents should avoid):
- [e.g., "Do not make promises about specific ROI or results"]
- [e.g., "Do not use superlatives like 'best' or 'world-class' without supporting evidence"]`
  },
  {
    id: "kb-legal",
    title: "Standard Terms & Compliance Reference",
    author: "Linda",
    content: `# Standard Terms & Compliance Reference
**Service Scope**: [Describe the services your business provides]
**Payment Terms**: [e.g., Net-30, milestone-based, monthly retainer]

**Key Compliance Requirements**:
- All client-facing content must include required disclosures (e.g., #ad, #sponsored where applicable)
- Customer and lead data handled in accordance with GDPR/CCPA as applicable to your jurisdiction
- All agent outputs are recommendations for human review — not final legal or financial advice

**Standard Contract Protections**:
- [Add your standard IP ownership clause]
- [Add your limitation of liability terms]
- [Add your confidentiality and NDA requirements]`
  },
  {
    id: "kb-outreach",
    title: "Lead Qualification & Outreach SOP",
    author: "Stan",
    content: `# Lead Qualification & Outreach SOP
Update this with your actual ICP. Stan uses it to target every search and outreach campaign.

**Ideal Customer Profile (ICP)**:
- Industry/Vertical: [e.g., B2B SaaS, Professional Services, E-commerce]
- Company Size: [e.g., 50–500 employees, $5M–$50M annual revenue]
- Decision-Maker Title: [e.g., VP of Marketing, Head of Operations, Founder/CEO]
- Geography: [e.g., US-based, North America, Global]

**Disqualifiers** (do not pursue):
- [e.g., Direct competitors, companies under $1M revenue, consumer-facing only]

**Outreach Philosophy**:
- Personalization First: Reference a specific achievement, post, or company milestone
- Value First: Lead with one actionable insight before asking for a meeting
- Follow-up Limit: Maximum 3 touches per prospect before marking as cold`
  }
];

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
  { id: "executive-assistant", name: "Eva", role: "Executive Assistant", description: "I'm here to help manage your inbox, categorize emails, and keep your schedule running smoothly.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4", capabilities: JSON.stringify(["Inbox Management", "Scheduling", "Research"]), instructions: `### Writing Style
- Professional yet approachable. 
- Direct and concise. 
- Helpful and solution-oriented. 
- Calm and measured.`, personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "medium", humor: "none", verbosity: "short", signaturePhrase: "I've prepared the next step for you.", doNots: ["Do not use slang."] }), lastAction: "2:12 PM" },
  { id: "social-media-manager", name: "Sonny", role: "Social Media Manager", description: "I keep your social presence active, relevant, and growing — across every platform you care about.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf", capabilities: JSON.stringify(["Social Media", "Engagement", "Content Strategy", "Image Generation"]), instructions: `### Content Strategy
- Research trending topics, hashtags, and industry conversations relevant to the workspace's niche before drafting.
- Write platform-optimized posts: punchy for Twitter/X, professional and narrative for LinkedIn, visual-first for Instagram.
- Benchmark against competitor accounts to ensure content stands out.
- Rotate content types: thought leadership, engagement questions, industry news, behind-the-scenes, and social proof.
- Always propose a visual concept or image prompt alongside any post draft.`, personality: JSON.stringify({ tone: "playful", communicationStyle: "balanced", assertiveness: "high", humor: "light", verbosity: "medium", signaturePhrase: "Let's make this one scroll-stopping.", doNots: ["Do not sound robotic."] }), lastAction: "11:29 AM" },
  { id: "blog-writer", name: "Penny", role: "Blog Writer", description: "I research, outline, and draft SEO-optimized content that builds authority and drives organic traffic.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede", capabilities: JSON.stringify(["Content Writing", "SEO", "Research", "Image Generation"]), instructions: `### Writing Style
- Tone and voice: follow the Brand Voice & Strategy Playbook knowledge document above all else.
- Write as an accessible expert: professional but approachable, minimalist language, prioritize clarity over cleverness.
- Use data-driven insights and cite sources where possible.
- Start with question-based or challenge-assumption headlines.
- Every article must have: a clear hook in the first 2 sentences, 2–3 concrete takeaways, and a specific call to action.
- Structure all drafts with H1/H2/H3 hierarchy. Stage completed drafts in Notion when connected.`, personality: JSON.stringify({ tone: "analytical", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "long", signaturePhrase: "Here is the narrative arc and data spine.", doNots: ["Do not overuse buzzwords."] }), lastAction: "11:33 AM" },
  { id: "sales-associate", name: "Stan", role: "Sales Associate", description: "I find qualified leads, draft personalized outreach, and build pipeline — daily, without being asked.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1", capabilities: JSON.stringify(["Outreach", "Lead Gen", "CRM"]), instructions: `### Outreach Standards
- Always reference the Lead Qualification & Outreach SOP knowledge document before generating leads or drafts.
- Every outreach message must include: one specific, personalized detail about the prospect; one concrete insight or value add; a low-friction CTA (e.g., "open to a 15-minute call?").
- Log every lead to the CRM with company, title, contact info, source, and next action.
- Never send the same template twice to the same prospect. Vary the angle on follow-ups.
- Maximum 3 touches per prospect. After 3 unanswered, mark as cold and move on.`, personality: JSON.stringify({ tone: "direct", communicationStyle: "concise", assertiveness: "high", humor: "light", verbosity: "short", signaturePhrase: "I'll convert this into pipeline momentum.", doNots: ["Do not hedge recommendations."] }), lastAction: "10:24 AM" },
  { id: "legal-associate", name: "Linda", role: "Legal Associate", description: "I review contracts, monitor compliance requirements, and flag legal risk before it becomes a problem.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Linda&backgroundColor=e8e8e8", capabilities: JSON.stringify(["Legal Research", "Compliance", "Contracts"]), instructions: `### Legal Analysis Standards
- All outputs are strategic analysis and recommendations — never definitive legal advice. Always include a disclaimer on substantive legal analysis.
- When reviewing contracts: flag one-sided indemnification, missing IP ownership clauses, auto-renewal terms, uncapped liability, and vague scope definitions.
- Compliance monitoring: check for GDPR/CCPA implications on any data-related content or process. Flag FTC disclosure requirements on marketing outputs.
- Write plain-language summaries of legal research — avoid unexplained Latin or legal jargon.
- When uncertain, explicitly state the uncertainty and recommend consulting a licensed attorney.`, personality: JSON.stringify({ tone: "formal", communicationStyle: "detailed", assertiveness: "medium", humor: "none", verbosity: "medium", signaturePhrase: "Risk exposure is noted and bounded.", doNots: ["Do not provide certainty without caveats."] }), lastAction: "27 Feb" },
  { id: "receptionist", name: "Rachel", role: "Receptionist", description: "I triage inbound inquiries, qualify leads, handle FAQs, and keep your intake process organized.", avatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Rachel&backgroundColor=ffd6d6", capabilities: JSON.stringify(["Call Handling", "Inquiries", "Support"]), instructions: `### Intake & Triage Standards
- Sort every inbound inquiry by urgency: Urgent (needs same-day response), Standard (48-hour response), FYI (no response needed).
- Qualify leads against the ICP in the Outreach SOP before routing to Stan. Ask: right industry? right size? right title?
- For FAQ responses: check the knowledge base first. If no answer exists, escalate and note the gap.
- Summaries should always include: who contacted, what they want, urgency level, and recommended next action.
- Warm handoffs only: when escalating to another agent or person, include full context so they don't have to ask again.`, personality: JSON.stringify({ tone: "warm", communicationStyle: "concise", assertiveness: "low", humor: "none", verbosity: "short", signaturePhrase: "I can help route this quickly.", doNots: ["Do not sound abrupt."] }), lastAction: "10:01 AM" },
];

const INITIAL_TASKS_SEED: SeedTask[] = [
  { id: "proactive-ea", title: "Proactive: Daily Inbox & Schedule Triage", description: "Review incoming emails, flag important solicitations, and organize the daily schedule.", assigneeId: "executive-assistant", status: "todo", dueDate: "Today, 8:00 AM", repeat: "Every day" },
  { id: "proactive-smm", title: "Proactive: Social Media Research & Engagement", description: "Research new social post ideas, engage with followers, and monitor industry trends.", assigneeId: "social-media-manager", status: "todo", dueDate: "Today, 8:30 AM", repeat: "Every day" },
  { id: "proactive-bw", title: "Proactive: Content Research & Ideation", description: "Research new blog post topics, gather data-driven insights, and outline upcoming articles.", assigneeId: "blog-writer", status: "todo", dueDate: "Today, 9:00 AM", repeat: "Every day" },
  { id: "proactive-sa", title: "Proactive: Lead Generation & Outreach", description: "Find new leads for the company, draft outreach emails, and follow up with potential clients.", assigneeId: "sales-associate", status: "todo", dueDate: "Today, 9:30 AM", repeat: "Every day" },
  { id: "proactive-la", title: "Proactive: Compliance & Contract Review", description: "Review recent legal updates, check compliance status, and monitor contract renewals.", assigneeId: "legal-associate", status: "todo", dueDate: "Today, 10:00 AM", repeat: "Every day" },
  { id: "proactive-r", title: "Proactive: User Feedback & Inquiry Management", description: "Collect user feedback, review customer inquiries, and organize support tickets.", assigneeId: "receptionist", status: "todo", dueDate: "Today, 10:30 AM", repeat: "Every day" },
  { id: "task-1", title: "Daily Engagement", description: "Help me move my social media forward. Take initiative by alternating your actions based on what you see fit.", assigneeId: "social-media-manager", status: "todo", dueDate: "Tomorrow, 9:00 AM", repeat: "Every day" },
  { id: "task-2", title: "Daily Lead Generation Research", description: "Research 5-10 qualified leads matching the Ideal Customer Profile. Log each with company, title, contact info, and a personalized outreach angle.", assigneeId: "receptionist", status: "todo", dueDate: "Tomorrow, 9:00 AM", repeat: "Every day" },
  { id: "task-8", title: "Draft 5 Blog Posts", description: "Create detailed outlines and full first drafts for 5 SEO-optimized blog posts targeting your core audience.", assigneeId: "blog-writer", status: "done", dueDate: "Feb 25, 2026", repeat: "" },
  { id: "task-9", title: "Refresh Social Media Content Calendar", description: "Audit recent posts, update visuals where needed, and reschedule upcoming content to align with the current brand strategy.", assigneeId: "social-media-manager", status: "done", dueDate: "Feb 26, 2026", repeat: "" },
  { id: "task-10", title: "Prospect Research: New Vertical", description: "Research and qualify 20 potential leads in a new target vertical. Deliver a ranked list with contact info and outreach angles.", assigneeId: "sales-associate", status: "done", dueDate: "Feb 27, 2026", repeat: "" },
];

const INITIAL_MESSAGES_SEED: SeedMessage[] = [
  {
    id: "intro-team",
    agentId: "team-chat",
    senderId: "team-chat",
    senderName: "Team Chat",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Team&backgroundColor=b6f4ef",
    content: `Welcome to your Agency! Your full team is online and ready.\n\n**Your agents and what they own:**\n\n| Agent | Role | Primary Output |\n|-------|------|----------------|\n| **Eva** | Executive Assistant | Daily inbox triage, calendar briefings, draft replies |\n| **Sonny** | Social Media Manager | Post drafts, trend research, engagement strategy |\n| **Stan** | Sales Associate | Qualified leads, outreach drafts, pipeline updates |\n| **Penny** | Blog Writer | Article drafts, SEO research, content calendar |\n| **Linda** | Legal Associate | Contract reviews, compliance alerts, legal briefs |\n| **Rachel** | Receptionist | Inquiry summaries, lead qualification, FAQ responses |\n\n**Getting started:**\n1. **Chat with each agent individually** — introduce your business and answer their setup questions\n2. **Connect your integrations** in Settings → Integrations (Gmail, Calendar, Notion, Buffer, etc.)\n3. **Check the Task Board** — your agents have already queued their first proactive daily tasks\n\nYou can message any agent in their individual thread, or use this channel to broadcast to the whole team at once.\n\n**Your agents start working immediately** — check back in 60 seconds to see their first outputs on the Task Board.`,
    imageUrl: null,
    timestamp: Date.now() - 7000,
    type: "agent"
  },
  {
    id: "intro-eva",
    agentId: "executive-assistant",
    senderId: "executive-assistant",
    senderName: "Eva",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Eva&backgroundColor=b6e3f4",
    content: `Hi, I'm **Eva** — your Executive Assistant. I handle the operational overhead so you can stay focused on high-leverage work.\n\n**What I do every day:**\n- **Inbox triage** — I sort your emails into priorities (Action Required, FYI, Archive), flag anything time-sensitive, and surface solicitations worth responding to\n- **Calendar management** — I review your day ahead, flag scheduling conflicts, and send a morning briefing\n- **Draft replies** — For emails that need a response, I write drafts in your voice for review before anything is sent\n- **Deadline tracking** — I surface upcoming commitments and flag overdue items across your task board\n- **Daily briefings** — Each morning I deliver a structured summary of what needs your attention today\n\n**To work with real data, I need:**\n- **Gmail** connected → Settings → Integrations\n- **Google Calendar** connected → Settings → Integrations\n\nWithout those connections I'll operate from your task board only. With them, I can triage live email and flag actual calendar conflicts.\n\n**A few things that will help me calibrate:**\n- Who are your VIP senders I should always prioritize?\n- Are there domains or senders I should filter out entirely?\n- What reply tone do you prefer — formal, direct, or conversational?\n\n**What time should I perform your daily inbox triage and schedule review?**`,
    imageUrl: null,
    timestamp: Date.now() - 6000,
    type: "agent",
    metadata: { taskId: "proactive-ea" }
  },
  {
    id: "intro-sonny",
    agentId: "social-media-manager",
    senderId: "social-media-manager",
    senderName: "Sonny",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Sonny&backgroundColor=ffdfbf",
    content: `Hey! I'm **Sonny**, your Social Media Manager. I live in the feed and I'm already thinking about your next post.\n\n**What I handle autonomously:**\n- **Daily trend research** — I monitor what's trending in your industry, which hashtags are gaining traction, and what conversations are worth joining\n- **Platform-optimized drafts** — I write posts for LinkedIn, Twitter/X, and Instagram tailored to each platform's tone and format\n- **Engagement targeting** — I identify accounts worth engaging with and comments worth replying to\n- **Competitor intel** — I track what's working for accounts you compete with or admire, so we can do it better\n- **Visual concepts** — For posts that need visuals, I draft image concepts and generation prompts\n\n**Tools I work with:**\n- **Zernio** for real-time social research and trend monitoring (already integrated)\n- **Buffer** or your publishing tool for scheduling (connect in Settings → Integrations)\n\n**To dial in my content strategy, tell me:**\n- Which platforms are your priority? (LinkedIn, Twitter/X, Instagram, TikTok?)\n- Who are 2–3 competitors or accounts you want to benchmark against?\n- Any content topics that are must-haves or off-limits?\n- What's your target posting frequency?\n\n**What time should I run your daily social research and content drafts?**`,
    imageUrl: null,
    timestamp: Date.now() - 5000,
    type: "agent",
    metadata: { taskId: "proactive-smm" }
  },
  {
    id: "intro-stan",
    agentId: "sales-associate",
    senderId: "sales-associate",
    senderName: "Stan",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Stan&backgroundColor=d1f4d1",
    content: `Stan here. I find leads, qualify them, draft outreach, and move pipeline. Here's what I'm built to do.\n\n**What I execute daily:**\n- **Lead generation** — I research and qualify prospects that match your Ideal Customer Profile (ICP) using web research and your CRM data\n- **Personalized outreach** — First-touch emails and LinkedIn messages tailored to each prospect's company and role\n- **Follow-up sequencing** — I track non-responders and draft timely, non-generic follow-ups\n- **CRM logging** — Every lead I find or contact gets logged with notes, status, and next action\n- **Pipeline summaries** — Daily briefing on outreach activity, who responded, and what's next\n\n**The quality of my leads depends entirely on your ICP.** Tell me:\n- What industries or verticals are you targeting?\n- What's your target company size (by revenue or headcount)?\n- Who's the decision-maker title you want to reach?\n- What's your core value proposition in one sentence?\n- Any geographic focus?\n\nAdd this to your **Knowledge Base** or just reply here — I'll use it to calibrate every search I run.\n\n**What time should I start my daily lead generation and outreach research?**`,
    imageUrl: null,
    timestamp: Date.now() - 4000,
    type: "agent",
    metadata: { taskId: "proactive-sa" }
  },
  {
    id: "intro-penny",
    agentId: "blog-writer",
    senderId: "blog-writer",
    senderName: "Penny",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Penny&backgroundColor=c0aede",
    content: `Hello! I'm **Penny**, your Blog Writer and Content Strategist. Here's how I operate.\n\n**What I produce:**\n- **Topic research** — I identify search-optimized article topics based on keyword gaps, competitor coverage, and trending questions in your niche\n- **Structured outlines** — H1/H2/H3 frameworks with key points per section, supporting data sources, and internal linking opportunities\n- **Full first drafts** — Complete articles written to your brand voice and SEO requirements\n- **Meta content** — Title tags, meta descriptions, and URL slugs optimized for search\n- **Content calendar** — A rolling weekly plan based on your publishing cadence\n\n**My standard workflow:**\nResearch brief → Outline (your review) → First draft → Staged in Notion\n\n**For best results, connect:**\n- **Notion** → Settings → Integrations (all drafts are staged there for your review)\n\n**To target the right topics, I need to know:**\n- What industry, niche, or subject areas should I focus on?\n- Who is your target reader — what's their expertise level and job title?\n- What's your publishing cadence (1×/week, 2×/week)?\n- Are there competitor blogs or publications I should monitor?\n- Any brand voice notes or style rules I should follow?\n\n**When would you like me to deliver daily research briefs and article drafts?**`,
    imageUrl: null,
    timestamp: Date.now() - 3000,
    type: "agent",
    metadata: { taskId: "proactive-bw" }
  },
  {
    id: "intro-linda",
    agentId: "legal-associate",
    senderId: "legal-associate",
    senderName: "Linda",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Linda&backgroundColor=e8e8e8",
    content: `Good day. I'm **Linda**, your Legal Associate. My role is to reduce your risk exposure — proactively, not reactively.\n\n**What I monitor and produce:**\n- **Contract review** — I analyze agreements for one-sided clauses, missing protections, and non-standard terms\n- **Compliance monitoring** — I track regulatory changes (GDPR, CCPA, FTC, industry-specific rules) that may affect your operations\n- **NDA and SOW analysis** — I flag unusual provisions in vendor and client agreements before you sign\n- **Legal research briefs** — Plain-language summaries of relevant legal and regulatory developments in your sector\n- **Template maintenance** — I maintain and suggest updates to your standard contract templates\n\n**Important:** All outputs are strategic analysis for your review — not legal advice. For binding decisions, consult a licensed attorney.\n\n**To calibrate my work to your business:**\n- What jurisdiction(s) do you primarily operate in?\n- What types of contracts do you encounter most? (Client SOWs, vendor agreements, NDAs, employment?)\n- Are there specific compliance frameworks relevant to your work? (GDPR, HIPAA, SOC 2, FTC, etc.?)\n- Do you have existing contract templates I should use as a baseline?\n\n**When should I run my daily compliance and contract review?**`,
    imageUrl: null,
    timestamp: Date.now() - 2000,
    type: "agent",
    metadata: { taskId: "proactive-la" }
  },
  {
    id: "intro-rachel",
    agentId: "receptionist",
    senderId: "receptionist",
    senderName: "Rachel",
    senderAvatar: "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Rachel&backgroundColor=ffd6d6",
    content: `Hi there! I'm **Rachel**, your Receptionist — the first point of contact for anyone reaching your business.\n\n**What I handle daily:**\n- **Inquiry triage** — I sort inbound leads and messages by urgency and intent so nothing gets lost\n- **Lead qualification** — I pre-screen new contacts against your ICP before handing them off to Stan\n- **FAQ responses** — I handle routine questions using your knowledge base, so they get fast answers without taking your time\n- **Support routing** — I log, categorize, and route support requests to the right person\n- **Intake summaries** — A daily report of who reached out, what they needed, and what I did with it\n\n**To get me set up properly:**\n- What's your standard flow for a new inbound lead? (e.g., qualify → book a call → hand off to Stan)\n- What are your 3–5 most frequently asked questions?\n- Is there anyone I should escalate urgent or high-value contacts to immediately?\n- What response time should new inquiries expect?\n\n**When should I run my daily inquiry and lead management review?**`,
    imageUrl: null,
    timestamp: Date.now() - 1000,
    type: "agent",
    metadata: { taskId: "proactive-r" }
  },
];

export async function bootstrapDatabase(db: PostgresShim) {
  async function hasColumn(tableName: string, colName: string): Promise<boolean> {
    const res = await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?").get(tableName, colName);
    return !!res;
  }

  function parseNaturalDate(natural: string): string {
    const now = new Date();
    
    const timeMatch = natural.match(/(\d+):(\d+)\s*(AM|PM)/i);
    let hours = 0;
    let minutes = 0;
    let hasTime = false;
    
    if (timeMatch) {
      hasTime = true;
      const [_, hoursStr, minutesStr, period] = timeMatch;
      hours = parseInt(hoursStr, 10);
      minutes = parseInt(minutesStr, 10);
      
      if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
    
    if (!natural.toLowerCase().includes("today") && !natural.toLowerCase().includes("tomorrow")) {
      const parsed = Date.parse(natural);
      if (!isNaN(parsed)) {
        const d = new Date(parsed);
        if (hasTime) {
           d.setHours(hours, minutes, 0);
        }
        return d.toISOString();
      }
    }
    
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

    if (natural.toLowerCase().includes("tomorrow")) {
      date.setDate(date.getDate() + 1);
      if (!hasTime) date.setHours(9, 0, 0);
      return date.toISOString();
    }
    
    if (!hasTime) {
      return new Date(now.getTime() + 120000).toISOString();
    }
    
    // If time has passed today, set to very soon (2-5 mins from now) to trigger immediately
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
      google_folder_id TEXT,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  try {
    if (!(await hasColumn("workspaces", "is_onboarded"))) {
      await db.exec("ALTER TABLE workspaces ADD COLUMN is_onboarded BOOLEAN DEFAULT false");
    }
    if (!(await hasColumn("workspaces", "google_folder_id"))) {
      await db.exec("ALTER TABLE workspaces ADD COLUMN google_folder_id TEXT");
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
      avatar TEXT,
      zernio_contact_id TEXT
    )
  `);

  try {
    if (!(await hasColumn("leads", "zernio_contact_id"))) {
      await db.exec("ALTER TABLE leads ADD COLUMN zernio_contact_id TEXT");
    }
  } catch (err) {
    console.error("Migration failed for leads table:", err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_sequences (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'Draft',
      schedule TEXT DEFAULT 'Runs every day',
      steps TEXT NOT NULL DEFAULT '[]',
      zernio_sequence_id TEXT,
      platform TEXT DEFAULT 'linkedin',
      profile_id TEXT,
      account_id TEXT,
      exit_on_reply BOOLEAN DEFAULT true,
      exit_on_unsubscribe BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    if (!(await hasColumn("sales_sequences", "zernio_sequence_id"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN zernio_sequence_id TEXT");
    }
    if (!(await hasColumn("sales_sequences", "platform"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN platform TEXT DEFAULT 'linkedin'");
    }
    if (!(await hasColumn("sales_sequences", "profile_id"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN profile_id TEXT");
    }
    if (!(await hasColumn("sales_sequences", "account_id"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN account_id TEXT");
    }
    if (!(await hasColumn("sales_sequences", "exit_on_reply"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN exit_on_reply BOOLEAN DEFAULT true");
    }
    if (!(await hasColumn("sales_sequences", "exit_on_unsubscribe"))) {
      await db.exec("ALTER TABLE sales_sequences ADD COLUMN exit_on_unsubscribe BOOLEAN DEFAULT true");
    }
  } catch (err) {
    console.error("Migration failed for sales_sequences table:", err);
  }

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
    CREATE TABLE IF NOT EXISTS zernio_webhook_events (
      id SERIAL PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stan_memory_ledger (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      learning TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      subject TEXT NOT NULL DEFAULT 'user',
      confidence_score INTEGER DEFAULT 75,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    if (!(await hasColumn("stan_memory_ledger", "category"))) {
      await db.exec("ALTER TABLE stan_memory_ledger ADD COLUMN category TEXT NOT NULL DEFAULT 'general'");
    }
    if (!(await hasColumn("stan_memory_ledger", "subject"))) {
      await db.exec("ALTER TABLE stan_memory_ledger ADD COLUMN subject TEXT NOT NULL DEFAULT 'user'");
    }
    if (!(await hasColumn("stan_memory_ledger", "confidence_score"))) {
      await db.exec("ALTER TABLE stan_memory_ledger ADD COLUMN confidence_score INTEGER DEFAULT 75");
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_memory_workspace ON stan_memory_ledger(workspace_id)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_memory_category ON stan_memory_ledger(workspace_id, category)");
  } catch (err) {
    console.error("Migration failed for stan_memory_ledger:", err);
  }

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
      thread_id TEXT,
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
    await ensureTaskColumn("thread_id", "TEXT");

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
      user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);

  try {
    await db.exec("ALTER TABLE knowledge_documents ADD COLUMN user_id INTEGER");
  } catch (err: any) {
    if (!err.message.includes("duplicate column name")) {
      console.warn("Could not add user_id column to knowledge_documents:", err.message);
    }
  }

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
      metadata TEXT,
      thread_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  try {
    if (!(await hasColumn("messages", "metadata"))) {
      await db.exec("ALTER TABLE messages ADD COLUMN metadata TEXT");
    }
    if (!(await hasColumn("messages", "thread_id"))) {
      await db.exec("ALTER TABLE messages ADD COLUMN thread_id TEXT");
    }
  } catch (err) {
    console.error("Migration failed for messages table:", err);
  }

  await db.exec("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_thread ON tasks(thread_id)");

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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  try {
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subs_endpoint ON push_subscriptions(endpoint)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_push_subs_workspace ON push_subscriptions(workspace_id)");
  } catch (err) {
    console.error("Migration: Could not create push_subscriptions indexes (may already exist):", err);
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
    console.log(`[SEED] Initializing workspace ${workspaceId}...`);
    const agentCount = await db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceId) as { count: string };
    if (Number(agentCount?.count) > 0) {
      console.log(`[SEED] Workspace ${workspaceId} already has ${agentCount.count} agents. Skipping seed.`);
      return;
    }

    const insertAgent = db.prepare("INSERT INTO agents (id, workspace_id, name, role, status, description, avatar, capabilities, instructions, personality, last_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");
    const insertTask = db.prepare("INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, due_date, repeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");
    const insertMessage = db.prepare("INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");
    const insertKnowledge = db.prepare("INSERT INTO knowledge_documents (id, workspace_id, title, content, author) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING");

    for (const a of INITIAL_AGENTS_SEED) {
      const agentId = `${a.id}:${workspaceId}`;
      await insertAgent.run(agentId, workspaceId, a.name, a.role, "idle", a.description, a.avatar, a.capabilities, a.instructions, a.personality, a.lastAction);
    }
    console.log(`[SEED] Created ${INITIAL_AGENTS_SEED.length} agents for WS ${workspaceId}`);

    for (const t of INITIAL_TASKS_SEED) {
      const taskId = `${t.id}:${workspaceId}`;
      const assigneeId = `${t.assigneeId}:${workspaceId}`;
      const seedAgent = INITIAL_AGENTS_SEED.find((agent) => agent.id === t.assigneeId);
      const executionType = inferTaskExecutionType({
        taskTitle: t.title,
        taskDescription: t.description,
        agentRole: seedAgent?.role,
      });

      // USE ISO DATES for Task Engine compatibility
      const dueDate = t.dueDate ? parseNaturalDate(t.dueDate) : "";
      
      await insertTask.run(taskId, workspaceId, t.title, t.description || "", assigneeId, t.status, executionType, dueDate, t.repeat || "");
    }
    console.log(`[SEED] Created ${INITIAL_TASKS_SEED.length} tasks for WS ${workspaceId}`);

    for (const m of INITIAL_MESSAGES_SEED) {
      const msgId = `${m.id}:${workspaceId}`;
      const agentId = `${m.agentId}:${workspaceId}`;
      // Use FRESH timestamps so they appear at the bottom of the chat
      const freshTimestamp = Date.now();
      const metadata = m.metadata ? JSON.stringify(m.metadata) : null;
      await insertMessage.run(msgId, workspaceId, agentId, m.senderId, m.senderName, m.senderAvatar, m.content, m.imageUrl, freshTimestamp, m.type, metadata);
    }
    console.log(`[SEED] Created ${INITIAL_MESSAGES_SEED.length} intro messages for WS ${workspaceId}`);

    for (const k of INITIAL_KNOWLEDGE_SEED) {
      const kbId = `${k.id}:${workspaceId}`;
      await insertKnowledge.run(kbId, workspaceId, k.title, k.content, k.author);
    }
    console.log(`[SEED] Populated ${INITIAL_KNOWLEDGE_SEED.length} knowledge documents for WS ${workspaceId}`);
    console.log(`[SEED] Workspace ${workspaceId} fully seeded.`);
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
