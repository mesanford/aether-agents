import { Agent, AgentRole, AgentStatus, Task, Message } from './types';

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'team-chat',
    name: 'Team Chat',
    role: AgentRole.TEAM_CHAT,
    status: AgentStatus.IDLE,
    description: "Collaborative space where all agents can communicate.",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Team&gender=male',
    capabilities: ['Collaboration', 'Team Communication'],
    lastAction: 'Just now',
    guidelines: []
  },
  {
    id: 'executive-assistant',
    name: 'Eva',
    role: AgentRole.EXECUTIVE_ASSISTANT,
    status: AgentStatus.IDLE,
    description: "I've scanned that latest Qwoted email for you...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female',
    capabilities: ['Inbox Management', 'Scheduling', 'Research'],
    lastAction: '2:12 PM',
    guidelines: [
      {
        id: '1',
        title: "Any specific rules to help me categorize your emails better?",
        items: [
          { id: '1', content: "Flag RFP/RFI solicitations to Marcus only when the email explicitly uses the terms \"RFP\", \"RFI\", or \"solicitation\". Do not flag general job postings, job-matching, or freelance opportunities from platforms like Twine. Prioritize flagging official procurement notices, especially from .gov or .edu domains." }
        ],
        showInput: true
      },
      {
        id: '2',
        title: "How should I write emails?",
        items: [
          { id: '1', content: `# Email Tone and Style Analysis

## Overall Tone
- **Professional yet approachable**: Maintains business professionalism while being personable and conversational
- **Direct and concise**: Gets to the point quickly without unnecessary pleasantries or filler
- **Helpful and solution-oriented**: Focuses on providing information, solving problems, or moving projects forward
- **Calm and measured**: Even when expressing frustration (payout issues), maintains composure and professionalism`, isMarkdown: true }
        ],
        showInput: false
      }
    ]
  },
  {
    id: 'social-media-manager',
    name: 'Sonny',
    role: AgentRole.SOCIAL_MEDIA_MANAGER,
    status: AgentStatus.IDLE,
    description: "Sweet. Everything's locked, loaded, and looking much more...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male',
    capabilities: ['Social Media', 'Engagement', 'Content Strategy', 'Image Generation'],
    lastAction: '11:29 AM',
    guidelines: [
      {
        id: '1',
        title: "Content Themes",
        items: [
          { id: '1', content: `• Google Search algorithm updates and ranking volatility
• Google AI features and developments (AI Overviews, LLMs)
• Google technical SEO (Googlebot crawling, indexing limits, file types)
• Google's financial performance and revenue reports
• Google Ads and PPC (invalid clicks, ad network)
• Content quality and Google's treatment of specific content types (listicles, reviews)
• Microsoft AI initiatives and publisher partnerships
• SEO industry news and commentary
• Technical implementation for search engines (markdown pages, structured data)
• Google company news and personnel updates` },
          { id: '2', content: `* Google Apps Script for Data Integration and Process Automation
* Python for search engine optimization and language processing
* Google BigQuery for reporting and data integration
* Google Looker Studio for reporting, dashboards, and visualization
* Google Analytics` },
          { id: '3', content: "Digital analytics and web analytics" },
          { id: '4', content: "Prioritize these recurring themes in social content: The Innovation Paradox, The ROI Shield, Technical Debt, Python for SEO, and Agentic Optimization." },
          { id: '5', content: "Prioritize technical consulting ideas (e.g., Google Discover visibility issues, AI increasing ranking costs, intent clustering, programmatic gap analysis) and avoid salesy/off-brand concepts (e.g., \"AI agents that answer the phone\")." }
        ],
        showInput: false
      }
    ]
  },
  {
    id: 'blog-writer',
    name: 'Penny',
    role: AgentRole.BLOG_WRITER,
    status: AgentStatus.IDLE,
    description: "I've got some good news! To bypass that...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female',
    capabilities: ['Content Writing', 'SEO', 'Research', 'Image Generation'],
    lastAction: '11:33 AM',
    guidelines: [
      {
        id: '1',
        title: "Writing Style",
        items: [
          { 
            id: '1', 
            content: `**Sanford Consulting: Tone & Style Guide**

1. Core Philosophy: The "Technical Peer" / "Accessible Expert"

Sanford Consulting does not talk at clients; it talks with them as a high-level strategic partner. Maintain expert credibility while prioritizing clarity and minimalism. Explain the data so it makes sense to a CEO.

The Brand Promise: Get Found. Get Cited. Get Qualified Leads.` 
          },
          { 
            id: '2', 
            content: `# Tone Analysis

- Write as an accessible expert: professional but casual, minimalist language, prioritize clarity
- Prefer data-driven insights and actionable advice over commentary
- Use clean structure with clear headings and bullet points
- Keep wit for internal drafts; keep external blog posts in "Accessible Expert" voice
- Start with question-based headlines that challenge assumptions or provoke curiosity about the topic
- Use italicized text sparingly and only when it improves clarity
- Insert skepticism about conventional wisdom early in the piece, but keep it measured and` 
          }
        ],
        showInput: true
      }
    ]
  },
  {
    id: 'sales-associate',
    name: 'Stan',
    role: AgentRole.SALES_ASSOCIATE,
    status: AgentStatus.IDLE,
    description: "Lead outreach is set for today: 12 emails...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stan&gender=male',
    capabilities: ['Outreach', 'Lead Gen', 'CRM'],
    lastAction: '10:24 AM',
    guidelines: []
  },
  {
    id: 'legal-associate',
    name: 'Linda',
    role: AgentRole.LEGAL_ASSOCIATE,
    status: AgentStatus.IDLE,
    description: "Awesome! Nice work getting that knocked...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Linda&gender=female',
    capabilities: ['Legal Research', 'Compliance', 'Contracts'],
    lastAction: '27 Feb',
    guidelines: []
  },
  {
    id: 'receptionist',
    name: 'Rachel',
    role: AgentRole.RECEPTIONIST,
    status: AgentStatus.IDLE,
    description: "Done! I've sent those 10 agency leads...",
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rachel&gender=female',
    capabilities: ['Call Handling', 'Inquiries', 'Support'],
    lastAction: '10:01 AM',
    guidelines: []
  },
];

export const INITIAL_MESSAGES: Record<string, Message[]> = {
  'social-media-manager': [
    {
      id: '1',
      senderId: 'user',
      senderName: 'Marcus Sanford',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
      content: "Sonny, please recreate the images for all scheduled and draft blog posts to fit our brand look and feel, just like you did for the \"Higher ed has an Innovation Paradox\" post.",
      timestamp: Date.now() - 1000000,
      type: 'user'
    },
    {
      id: '2',
      senderId: 'social-media-manager',
      senderName: 'Sonny',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male',
      content: "I've been working through the queue to get every single post matched up with that clean MM Sanford aesthetic.\n\n**Here's where we're at:**\n\n* I've unscheduled and updated the images for **15 posts** to that minimalist, light-beige and Sanford Orange look.\n* I've also successfully rescheduled those new versions back to their original slots in March.\n\nThe system took a breather because I was moving so many pieces at once. I'm almost done—just need to double-check the last few drafts and any stragglers to make sure the \"brand glow-up\" is 100% complete.\n\nShould I keep going and finish off the last few?",
      timestamp: Date.now() - 500000,
      type: 'agent'
    },
    {
      id: '3',
      senderId: 'user',
      senderName: 'Marcus Sanford',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
      content: "yes",
      timestamp: Date.now() - 100000,
      type: 'user'
    },
    {
      id: '4',
      senderId: 'social-media-manager',
      senderName: 'Sonny',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male',
      content: "Sweet. Everything's locked, loaded, and looking much more \"Sanford\" now. 🎨\n\nSince the March calendar is officially a masterpiece, do you want me to keep the momentum going on the April queue, or are we taking a breather? ☕",
      timestamp: Date.now() - 50000,
      type: 'agent'
    }
  ],
  'team-chat': [
    {
      id: 't1',
      senderId: 'executive-assistant',
      senderName: 'Eva',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Eva&gender=female',
      content: "Hi team! I've set up this space for us to collaborate on the Sanford project. @Sonny, how is the brand glow-up coming along?",
      timestamp: Date.now() - 2000000,
      type: 'agent'
    },
    {
      id: 't2',
      senderId: 'social-media-manager',
      senderName: 'Sonny',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sonny&gender=male',
      content: "It's going great, Eva! Just finished the March calendar. @Penny, I might need some help with the April blog post visuals once you have the drafts ready.",
      timestamp: Date.now() - 1500000,
      type: 'agent'
    },
    {
      id: 't3',
      senderId: 'blog-writer',
      senderName: 'Penny',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penny&gender=female',
      content: "On it, Sonny! I'll have the first batch of April drafts to you by tomorrow EOD.",
      timestamp: Date.now() - 1000000,
      type: 'agent'
    }
  ]
};

export const INITIAL_TASKS: Task[] = [
  {
    id: 'proactive-ea',
    title: 'Proactive: Daily Inbox & Schedule Triage',
    description: 'Review incoming emails, flag important solicitations, and organize the daily schedule.',
    assigneeId: 'executive-assistant',
    status: 'todo',
    dueDate: 'Today, 8:00 AM',
    repeat: 'Every day'
  },
  {
    id: 'proactive-smm',
    title: 'Proactive: Social Media Research & Engagement',
    description: 'Research new social post ideas, engage with followers, and monitor industry trends.',
    assigneeId: 'social-media-manager',
    status: 'todo',
    dueDate: 'Today, 8:30 AM',
    repeat: 'Every day'
  },
  {
    id: 'proactive-bw',
    title: 'Proactive: Content Research & Ideation',
    description: 'Research new blog post topics, gather data-driven insights, and outline upcoming articles.',
    assigneeId: 'blog-writer',
    status: 'todo',
    dueDate: 'Today, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: 'proactive-sa',
    title: 'Proactive: Lead Generation & Outreach',
    description: 'Find new leads for the company, draft outreach emails, and follow up with potential clients.',
    assigneeId: 'sales-associate',
    status: 'todo',
    dueDate: 'Today, 9:30 AM',
    repeat: 'Every day'
  },
  {
    id: 'proactive-la',
    title: 'Proactive: Compliance & Contract Review',
    description: 'Review recent legal updates, check compliance status, and monitor contract renewals.',
    assigneeId: 'legal-associate',
    status: 'todo',
    dueDate: 'Today, 10:00 AM',
    repeat: 'Every day'
  },
  {
    id: 'proactive-r',
    title: 'Proactive: User Feedback & Inquiry Management',
    description: 'Collect user feedback, review customer inquiries, and organize support tickets.',
    assigneeId: 'receptionist',
    status: 'todo',
    dueDate: 'Today, 10:30 AM',
    repeat: 'Every day'
  },
  {
    id: '1',
    title: 'Daily Engagement',
    description: 'Help me move my social media forward. Take initiative by alternating your actions based on what you...',
    assigneeId: 'social-media-manager',
    status: 'todo',
    dueDate: 'Tomorrow, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: '2',
    title: 'Daily Lead Generation for Stan',
    description: 'Research 5-10 marketing agency leads in Illinois (Higher Ed, Gov, B2B branding) to act as potential...',
    assigneeId: 'receptionist',
    status: 'todo',
    dueDate: 'Tomorrow, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: '3',
    title: 'Daily Engagement',
    description: 'Help me move my social media forward. Take initiative by alternating your actions based on what you...',
    assigneeId: 'social-media-manager',
    status: 'done',
    dueDate: 'Today, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: '4',
    title: 'Daily Lead Generation for Stan',
    description: 'Research 5-10 marketing agency leads in Illinois (Higher Ed, Gov, B2B branding) to act as potential...',
    assigneeId: 'receptionist',
    status: 'done',
    dueDate: 'Today, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: '5',
    title: 'Draft weekly agency trends email for Aline Lin',
    description: 'Research and draft a weekly email for Aline Lin (a.lin@astriata.com) covering agency-focused SEO, ...',
    assigneeId: 'executive-assistant',
    status: 'todo',
    dueDate: 'Friday, 12:00 PM',
    repeat: 'Weekly'
  },
  {
    id: '6',
    title: 'Daily Lead Generation for Stan',
    description: 'Research 5-10 marketing agency leads in Illinois (Higher Ed, Gov, B2B branding) to act as potential...',
    assigneeId: 'receptionist',
    status: 'done',
    dueDate: 'Yesterday, 9:00 AM',
    repeat: 'Every day'
  },
  {
    id: '7',
    title: 'Fix Delinquent 2025 Annual Report',
    description: 'Review the legal requirements for the 2025 annual report and address any discrepancies found...',
    assigneeId: 'legal-associate',
    status: 'done',
    dueDate: 'Yesterday, 2:00 PM'
  },
  {
    id: '8',
    title: 'Draft 5 Blog Posts for March',
    description: 'Create detailed outlines and first drafts for 5 technical SEO blog posts.',
    assigneeId: 'blog-writer',
    status: 'done',
    dueDate: 'Feb 25, 2026'
  },
  {
    id: '9',
    title: 'Reschedule 15 Social Media Posts',
    description: 'Update images and reschedule 15 posts to match the new brand aesthetic.',
    assigneeId: 'social-media-manager',
    status: 'done',
    dueDate: 'Feb 26, 2026'
  },
  {
    id: '10',
    title: 'Research 20 leads for GovCon',
    description: 'Find 20 new leads in the government contracting space.',
    assigneeId: 'sales-associate',
    status: 'done',
    dueDate: 'Feb 27, 2026'
  }
];
