import { tool } from "@langchain/core/tools";
import { GoogleGenAI } from '@google/genai';
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import db from '../db.ts';
import { ShadowGitServer } from '../lib/git/shadow';
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const SHADOW_DIR = path.resolve(process.cwd(), '.shadow-workspace');

/**
 * Helper to call the Zernio API.
 */
async function zernioFetch(endpoint: string, options: RequestInit = {}) {
  const apiKey = process.env.ZERNIO_API_KEY;
  if (!apiKey) {
    throw new Error("Zernio API key is missing. Please add ZERNIO_API_KEY to your environment.");
  }

  const response = await fetch(`https://zernio.com/api/v1${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json() as any;
  if (!response.ok) {
    const errorDetail = data.message || data.error || JSON.stringify(data);
    throw new Error(`Zernio API error ${response.status}: ${errorDetail}`);
  }
  return data;
}

export const queryBrainTool = tool(
  async ({ query, category }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      // 1. Search Knowledge Documents
      const docs = await db.prepare(`
        SELECT title, content, author
        FROM knowledge_documents
        WHERE workspace_id = ?
        AND (title ILIKE ? OR content ILIKE ?)
        LIMIT 5
      `).all(workspaceId, `%${query}%`, `%${query}%`) as any[];

      // 2. Search long-term memory, optionally filtered by category
      const memoryQuery = category
        ? `SELECT learning, category, subject, confidence_score FROM stan_memory_ledger WHERE workspace_id = ? AND category = ? AND learning ILIKE ? ORDER BY confidence_score DESC, updated_at DESC LIMIT 8`
        : `SELECT learning, category, subject, confidence_score FROM stan_memory_ledger WHERE workspace_id = ? AND learning ILIKE ? ORDER BY confidence_score DESC, updated_at DESC LIMIT 8`;
      const memoryArgs = category
        ? [workspaceId, category, `%${query}%`]
        : [workspaceId, `%${query}%`];
      const memories = await db.prepare(memoryQuery).all(...memoryArgs) as any[];

      if (docs.length === 0 && memories.length === 0) {
        return `No internal knowledge found matching '${query}'.`;
      }

      let result = `Internal knowledge results for '${query}':\n\n`;

      if (docs.length > 0) {
        result += `--- COMPANY DOCUMENTS ---\n`;
        result += docs.map(d => `Title: ${d.title}\nAuthor: ${d.author || 'Agency'}\nContent: ${d.content}`).join('\n\n');
        result += `\n\n`;
      }

      if (memories.length > 0) {
        result += `--- LONG-TERM MEMORY ---\n`;
        result += memories.map(m =>
          `[${m.category} / ${m.subject}] (confidence ${m.confidence_score}%) ${m.learning}`
        ).join('\n');
      }

      return result;
    } catch (err: any) {
      console.error("query_brain error:", err);
      return `Failed to query agency brain: ${err.message}`;
    }
  },
  {
    name: "query_brain",
    description: "Search the company's knowledge base and long-term agent memory. Use this to recall user preferences, business context, lessons learned, or company policies. Supports optional category filter: 'preference', 'fact', 'behavior', 'instruction'.",
    schema: z.object({
      query: z.string().describe("Keywords or topic to search for"),
      category: z.enum(['preference', 'fact', 'behavior', 'instruction', 'general']).optional().describe("Optional: filter results to a specific memory category"),
    })
  }
);

export const writeToMemoryTool = tool(
  async ({ learning, category, subject, confidence_score }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      // Dedup: look for an existing entry whose first 100 chars closely match
      const fingerprint = learning.trim().substring(0, 100);
      const existing = await db.prepare(`
        SELECT id FROM stan_memory_ledger
        WHERE workspace_id = ? AND learning ILIKE ?
        LIMIT 1
      `).get(workspaceId, `${fingerprint}%`) as any;

      if (existing) {
        await db.prepare(`
          UPDATE stan_memory_ledger
          SET learning = ?, category = ?, subject = ?, confidence_score = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(learning.trim(), category, subject || 'user', confidence_score ?? 75, existing.id);
        return `Memory updated (id ${existing.id}): "${learning.trim().substring(0, 80)}…"`;
      }

      const result = await db.prepare(`
        INSERT INTO stan_memory_ledger (workspace_id, learning, category, subject, confidence_score)
        VALUES (?, ?, ?, ?, ?)
        RETURNING id
      `).get(workspaceId, learning.trim(), category, subject || 'user', confidence_score ?? 75) as any;

      return `Memory saved (id ${result?.id}): "${learning.trim().substring(0, 80)}…"`;
    } catch (err: any) {
      console.error("write_to_memory error:", err);
      return `Failed to save memory: ${err.message}`;
    }
  },
  {
    name: "write_to_memory",
    description: "Save an important fact, preference, or pattern about the user or their business to long-term shared memory. All agents can read this. Use it when you learn something that should persist across future conversations — e.g. communication preferences, business context, recurring workflows, or explicit user instructions. Be specific and write in third-person declarative form: 'User prefers...' / 'The company is...'",
    schema: z.object({
      learning: z.string().describe("The memory to store, as a clear standalone statement (e.g. 'User prefers concise bullet-point summaries over long paragraphs')"),
      category: z.enum(['preference', 'fact', 'behavior', 'instruction']).describe("'preference' = user style/format preferences | 'fact' = business or personal facts | 'behavior' = observed patterns | 'instruction' = explicit user directives that should always apply"),
      subject: z.string().optional().describe("What this memory is about. Use 'user', 'company', 'product', or a specific name. Defaults to 'user'"),
      confidence_score: z.number().min(1).max(100).optional().describe("Confidence 1–100. Use 90+ for explicit user statements, 70–85 for strongly implied preferences, 50–65 for inferred patterns"),
    })
  }
);

export const searchGoogleDriveTool = tool(
  async ({ query }, config) => {
    const workspaceId = config?.configurable?.workspace_id || config?.configurable?.workspaceId || 1;
    try {
      const workspace = await db.prepare('SELECT google_refresh_token, google_folder_id FROM workspaces WHERE id = ?').get(workspaceId) as any;
      
      if (!workspace?.google_refresh_token || !workspace?.google_folder_id) {
        return "Google Drive is not connected. The user must connect it via Settings -> Integrations.";
      }
      
      const { getOAuthClient, searchFilesInFolder } = await import('../../services/googleDriveService.ts');
      const auth = getOAuthClient();
      auth.setCredentials({ refresh_token: workspace.google_refresh_token });
      
      const results = await searchFilesInFolder(auth, workspace.google_folder_id, query);
      if (!results || results.length === 0) return `No Google Drive files matched '${query}'.`;
      
      return results.join('\n\n---\n\n');
    } catch (e) {
      console.error("search_google_drive err", e);
      return "Failed to search Google Drive.";
    }
  },
  {
    name: "search_google_drive",
    description: "Search the company's shared Google Drive knowledge folder for documents, PDFs, and files. Use this strictly when users ask to verify data from a shared doc, check a PDF, or read a file. Keywords: google drive, doc, spreadsheet, pdf, file, read.",
    schema: z.object({ query: z.string() })
  }
);

export const listEmailsTool = tool(
  async ({ maxResults, query }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      // 1. Get Google Credentials from DB
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) throw new Error("Workspace not found");

      const tokenRow = await db.prepare("SELECT access_token, refresh_token, expiry_date FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. Please tell the user to connect Gmail in the Integrations panel.";

      const client = new OAuth2Client({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      });

      client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      const gmail = google.gmail({ version: "v1", auth: client });
      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults: maxResults || 10,
        q: query || 'is:inbox'
      });

      if (!res.data.messages || res.data.messages.length === 0) {
        return "Your inbox is currently empty.";
      }

      const summaries = [];
      for (const msg of res.data.messages) {
        const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
        const headers = detail.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
        const date = headers.find(h => h.name === 'Date')?.value || 'No Date';
        summaries.push(`- FROM: ${from}\n  SUBJECT: ${subject}\n  DATE: ${date}\n  SNIPPET: ${detail.data.snippet}\n  ID: ${msg.id}`);
      }

      return `Recent Emails:\n\n${summaries.join('\n\n')}`;
    } catch (err: any) {
      console.error("list_emails error:", err);
      return `[FAILED] Could not fetch emails: ${err.message}`;
    }
  },
  {
    name: "list_emails",
    description: "Fetch a list of recent emails from the user's Gmail inbox. Use this for 'inbox triage' or to check for new messages. Keywords: check email, list mail, inbox triage, read messages.",
    schema: z.object({
      maxResults: z.number().optional().describe("Number of emails to fetch (default 10)."),
      query: z.string().optional().describe("Gmail search query (e.g. 'is:unread' or 'from:someone@example.com').")
    })
  }
);

export const draftEmailTool = tool(
  async ({ to, subject, body }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Get workspace owner and tokens
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) return "[FAILED] Workspace not found.";

      const tokenRow = await db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. The user must connect it via Settings -> Integrations.";

      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      // 2. Handle token refresh if needed
      if (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000) {
        const { credentials } = await client.refreshAccessToken();
        await db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(
          credentials.access_token,
          credentials.expiry_date,
          workspace.owner_id
        );
        client.setCredentials(credentials);
      }

      // 3. Create the draft via Gmail API
      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth: client });

      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];
      const message = messageParts.join("\n");

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

      return `[SUCCESS] Real draft saved in Gmail for ${to} regarding "${subject}". DRAFT_ID: ${draftRes.data.id}`;
    } catch (err: any) {
      console.error("draft_email error:", err);
      return `[FAILED] Could not create Gmail draft: ${err.message}`;
    }
  },
  {
    name: "draft_email",
    description: "Create a real email draft in the user's Gmail account. Use this strictly when users ask to stage a response, draft an email, or prepare a reply. Keywords: email, draft, stage, reply, gmail, write mail.",
    schema: z.object({ 
      to: z.string().describe("Recipient email address."), 
      subject: z.string().describe("Email subject line."), 
      body: z.string().describe("The full content of the email.") 
    })
  }
);

export const readGoogleChatTool = tool(
  async ({ space, limit = 5 }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Get workspace owner and tokens
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) return "[FAILED] Workspace not found.";

      const tokenRow = await db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. The user must connect it via Settings -> Integrations.";

      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      // 2. Handle token refresh if needed
      if (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000) {
        const { credentials } = await client.refreshAccessToken();
        await db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(
          credentials.access_token,
          credentials.expiry_date,
          workspace.owner_id
        );
        client.setCredentials(credentials);
      }

      const { google } = await import("googleapis");
      const chat = google.chat({ version: "v1", auth: client });

      // 3. If space is provided, try to read messages
      if (space) {
        let targetSpaceId = space;
        
        // If 'space' doesn't look like a resource name (spaces/...), try to find it by display name
        if (!space.startsWith("spaces/")) {
          const spacesRes = await chat.spaces.list();
          const found = spacesRes.data.spaces?.find(s => s.displayName?.toLowerCase() === space.toLowerCase());
          if (found?.name) {
            targetSpaceId = found.name;
          } else {
            return `[FAILED] Could not find a Google Chat space named '${space}'. Use the tool without a space name to list all available spaces first.`;
          }
        }

        const messagesRes = await chat.spaces.messages.list({
          parent: targetSpaceId,
          pageSize: limit,
        });

        const messages = messagesRes.data.messages || [];
        if (messages.length === 0) return `No recent messages found in space '${space}'.`;

        const formattedMessages = messages.map(m => {
          const sender = m.sender?.displayName || "Unknown";
          const time = m.createTime ? new Date(m.createTime).toLocaleString() : "Unknown time";
          return `[${time}] ${sender}: ${m.text}`;
        }).reverse().join("\n");

        return `Recent messages in '${space}':\n\n${formattedMessages}`;
      }

      // 4. If no space provided, list available spaces
      const spacesRes = await chat.spaces.list();
      const spaces = spacesRes.data.spaces || [];
      
      if (spaces.length === 0) return "No Google Chat spaces found for this account.";

      const spaceList = spaces.map(s => `- ${s.displayName} (ID: ${s.name})`).join("\n");
      return `Available Google Chat Spaces:\n\n${spaceList}\n\nUse this tool again with a specific space name or ID to read its messages.`;

    } catch (err: any) {
      console.error("read_google_chat error:", err);
      if (err.message?.includes("scope")) {
        return "[FAILED] Insufficient permissions. The user needs to reconnect Google via Integrations to grant Google Chat access.";
      }
      return `[FAILED] Could not read Google Chat: ${err.message}`;
    }
  },
  {
    name: "read_google_chat",
    description: "Read recent messages from Google Chat spaces. If no space name is provided, it lists all available spaces. Use this to monitor team communications or look for specific alerts. Keywords: chat, google chat, messages, spaces, team talk.",
    schema: z.object({ 
      space: z.string().optional().describe("The display name or resource ID (spaces/...) of the space to read. Leave empty to list all spaces."), 
      limit: z.number().optional().describe("Number of recent messages to retrieve. Default is 5.") 
    })
  }
);

export const searchWebTool = tool(
  async ({ query }) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return "Web search is not configured. Please add SERPER_API_KEY to your environment variables.";
    }

    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query }),
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;
      
      const results = [];
      if (data.organic) {
        results.push(...data.organic.slice(0, 5).map((res: any) => 
          `Title: ${res.title}\nLink: ${res.link}\nSnippet: ${res.snippet}`
        ));
      }

      if (results.length === 0) {
        return `No organic results found for '${query}'.`;
      }

      return `Top search results for '${query}':\n\n${results.join('\n\n---\n\n')}`;
    } catch (err: any) {
      console.error("search_web error:", err);
      return `Failed to perform web search: ${err.message}`;
    }
  },
  {
    name: "search_web",
    description: "Search the public internet for articles, trends, news, or prospect research. Use this to find current events, verify facts, or gather intelligence for blog posts and social media. Keywords: search, find, research, news, lookup, google.",
    schema: z.object({ query: z.string() })
  }
);

export const readWebsiteTool = tool(
  async ({ url }) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(`https://r.jina.ai/${url}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Jina.ai failed with status ${response.status}`);
      const markdown = await response.text();
      return markdown.substring(0, 15000); 
    } catch (err: any) {
      console.error("read_website error:", err);
      if (err.name === 'AbortError') {
        return `[FAILED] Website reading timed out after 30 seconds. The site might be too slow or blocking our reader. Try a different URL or search_web instead.`;
      }
      return `[FAILED] Could not read website: ${err.message}. Make sure the URL is valid and starts with http:// or https://.`;
    }
  },
  {
    name: "read_website",
    description: "Read the content of any website URL. Use this whenever you need to research a company, analyze a competitor, verify information from a specific site, or gather data from the web. Returns a clean markdown version of the page content. Keywords: read url, browse site, visit website, scrape page, research, analyze site.",
    schema: z.object({
      url: z.string().describe("The full URL of the website to read (including https://).")
    })
  }
);

export const generateImageTool = tool(
  async ({ prompt, style }, config) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{ role: 'user', parts: [{ text: `Generate a high-quality social media graphic for: ${prompt}. Style: ${style || 'modern, clean, professional'}.` }] }],
      });

      // Find the image part in the response
      const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      
      if (imagePart && imagePart.inlineData) {
        const base64 = imagePart.inlineData.data;
        const dataUrl = `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${base64}`;
        let mediaAssetId = null;
        let storedUrl = dataUrl;
        
        if (config?.configurable?.thread_id) {
          try {
            const threadId = config.configurable.thread_id as string;
            const workspaceId = config.configurable?.workspace_id || 1;
            
            const insertResult = await db.prepare(`
              INSERT INTO media_assets (workspace_id, name, type, category, thumbnail, size, author)
              VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
            `).get(workspaceId, `AI Generation: ${prompt.substring(0, 30)}...`, 'image', 'generated', dataUrl, 'Unknown', threadId.includes('social-media-manager') ? 'Sonny' : 'Penny') as any;
            mediaAssetId = insertResult.id;
            // Return a reference the agent can actually use or show
            storedUrl = `/api/workspaces/${workspaceId}/media/${mediaAssetId}/view`;
          } catch (dbErr: any) {
            console.error("Failed to save generated image to DB:", dbErr);
          }
        }
        
        return `[IMAGE GENERATED] Visual for '${prompt}' created. 
URL: ${storedUrl}
MEDIA_ASSET_ID: ${mediaAssetId || 'unknown'}
Instruction: For social posts, pass the string "MEDIA_ASSET_ID:${mediaAssetId}" into the mediaUrls array of the schedule_social_post tool. For blogs, pass the numeric ID directly into the mediaAssetId field of publish_blog_post.`;
      }
      return `[IMAGE GENERATION FAILED] No image data returned. Text response: ${response.text || 'None'}`;
    } catch (err: any) {
      console.error("generate_image error:", err);
      return `[IMAGE GENERATION FAILED] ${err.message}`;
    }
  },
  {
    name: "generate_image",
    description: "Generate a graphic for social media or blog posts using AI. Keywords: picture, visual, drawing, image, photo, art, plan, brainstorm, create.",
    schema: z.object({ prompt: z.string(), style: z.string().optional() })
  }
);

export const scheduleSocialPostTool = tool(
  async (args, config) => {
    try {
      // 1. Resolve Account IDs for the requested platforms
      let connectedAccounts = [];
      try {
        const accountsRes = await zernioFetch('/accounts');
        connectedAccounts = accountsRes.accounts || [];
      } catch (accErr: any) {
        console.error("Failed to fetch Zernio accounts:", accErr);
        return `[FAILED] Could not connect to Zernio to verify your social accounts: ${accErr.message}. Ensure your ZERNIO_API_KEY is valid.`;
      }
      
      const targetPlatforms = Array.isArray(args.platforms) ? args.platforms : [args.platforms];
      const platformPayloads = [];
      const missingPlatforms = [];

      for (const p of targetPlatforms) {
        const lowerP = p.toLowerCase().trim();
        const account = connectedAccounts.find((a: any) => a.platform.toLowerCase() === lowerP);
        
        if (!account) {
          missingPlatforms.push(p);
          continue;
        }

        platformPayloads.push({
          platform: lowerP,
          accountId: account.id,
          platformSpecificContent: null
        });
      }

      if (missingPlatforms.length > 0) {
        const available = connectedAccounts.map((a: any) => a.platform).join(', ');
        return `[FAILED] The following platforms are not connected in Zernio: ${missingPlatforms.join(', ')}. Available connected platforms are: ${available || 'None'}. Please tell the user to connect these in the Integrations panel.`;
      }

      // 2. Resolve Media URLs (convert MEDIA_ASSET_ID to actual data or proxy URLs)
      const resolvedMediaUrls = [];
      const workspaceId = config?.configurable?.workspace_id || 1;
      
      if (args.mediaUrls && Array.isArray(args.mediaUrls)) {
        for (const url of args.mediaUrls) {
          if (typeof url === 'string' && url.startsWith('MEDIA_ASSET_ID:')) {
            const assetId = url.replace('MEDIA_ASSET_ID:', '').trim();
            const asset = await db.prepare("SELECT thumbnail FROM media_assets WHERE id = ? AND workspace_id = ?").get(assetId, workspaceId) as any;
            if (asset?.thumbnail) {
              resolvedMediaUrls.push(asset.thumbnail);
            }
          } else {
            resolvedMediaUrls.push(url);
          }
        }
      }

      // 3. Build the unified Zernio request
      const requestBody: any = {
        content: args.content,
        platforms: platformPayloads,
        mediaUrls: resolvedMediaUrls,
        publishNow: args.publishNow || false,
      };

      if (args.scheduledFor) {
        requestBody.scheduledFor = args.scheduledFor;
      }

      const res = await zernioFetch('/posts', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      return `[SUCCESS] Social post draft created and scheduled via Zernio for: ${targetPlatforms.join(', ')}. Post ID: ${res.id}. Tell the user the draft is now visible in their social dashboard for final review.`;
    } catch (err: any) {
      console.error("Zernio multi-post error:", err);
      return `[FAILED] Zernio rejected the post request: ${err.message}. Check that the content and media are valid.`;
    }
  },
  {
    name: "schedule_social_post",
    description: "REQUIRED TOOL for all social media work. Use this to draft, preview, or schedule posts for LinkedIn, Twitter, Instagram, etc. Never output drafts in chat; always use this tool so they appear in the user's social dashboard. The tool handles multi-platform posting and media attachments automatically. Keywords: post, draft, preview, schedule, publish.",
    schema: z.object({ 
      platforms: z.array(z.string()).describe("List of target platforms (e.g., ['twitter', 'linkedin', 'instagram'])."),
      content: z.string().describe("The base post text used for all platforms."), 
      publishNow: z.boolean().default(false).describe("Set to true to bypass scheduling and post immediately."),
      scheduledFor: z.string().optional().describe("ISO 8601 timestamp for future scheduling."),
      mediaUrls: z.array(z.string()).optional().describe("Array of image URLs or MEDIA_ASSET_ID:123 strings.")
    })
  }
);

export const draftSocialPostTool = tool(
  async (args, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || 'social-media-manager';
    
    let fetchedImageUrl = null;
    let mediaId = null;
    if (args.mediaUrls && args.mediaUrls.length > 0) {
      const url = args.mediaUrls[0];
      if (typeof url === 'string' && url.startsWith('MEDIA_ASSET_ID:')) {
        mediaId = parseInt(url.replace('MEDIA_ASSET_ID:', '').trim());
        try {
          const media = await db.prepare('SELECT thumbnail FROM media_assets WHERE id = ? AND workspace_id = ?').get(mediaId, workspaceId) as any;
          if (media?.thumbnail) fetchedImageUrl = media.thumbnail;
        } catch (err) {
          console.error("Failed to load media asset for social post draft", err);
        }
      } else {
        fetchedImageUrl = url;
      }
    }

    const targetPlatforms = Array.isArray(args.platforms) ? args.platforms : [args.platforms];

    const draftArtifact = JSON.stringify({
      title: `Post for ${targetPlatforms.join(', ')}`,
      body: args.content,
      bullets: [`Platforms: ${targetPlatforms.join(', ')}`],
      imageUrl: fetchedImageUrl
    });

    const taskId = `task-${Date.now()}`;
    const executionType = 'social_post';

    await db.prepare(`
      INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date, selected_media_asset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, workspaceId, `Social Post Draft: ${targetPlatforms.join(', ')}`, `Stage Content: ${args.content?.substring(0, 50)}...`, assigneeId, 'todo', executionType, draftArtifact, 'Drafting', mediaId);

    return `[SUCCESS] Social post draft staged for ${targetPlatforms.join(', ')}. ID: ${taskId}. Tell the user the preview is now visible in their social dashboard.`;
  },
  {
    name: "draft_social_post",
    description: "REQUIRED TOOL: You MUST use this tool to create a post preview or draft for ANY social media platform (LinkedIn, Twitter, Instagram, etc). Never output drafts in chat; always use this tool so they appear in the user's social dashboard. Keywords: preview, draft, create, plan, prepare. Note: this does not schedule or publish the post, it only creates a local preview.",
    schema: z.object({ 
      platforms: z.array(z.string()).describe("List of target platforms (e.g., ['twitter', 'linkedin', 'instagram'])."),
      content: z.string().describe("The base post text used for all platforms."),
      mediaUrls: z.array(z.string()).optional().describe("Array of image URLs or MEDIA_ASSET_ID:123 strings.")
    })
  }
);

export const publishBlogPostTool = tool(
  async (args, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || 'blog-writer';
    
    let fetchedImageUrl = null;
    if (args.mediaAssetId) {
      try {
        const media = await db.prepare('SELECT thumbnail FROM media_assets WHERE id = ?').get(args.mediaAssetId) as any;
        if (media?.thumbnail) fetchedImageUrl = media.thumbnail;
      } catch (err) {
        console.error("Failed to load media asset for blog post", err);
      }
    }

    const draftArtifact = JSON.stringify({
      title: args.title,
      body: args.content,
      bullets: [`Target: ${args.targetPlatform}`],
      imageUrl: fetchedImageUrl
    });

    const taskId = `task-${Date.now()}`;
    const plat = args.targetPlatform || '';
    const isNewsletter = plat.toLowerCase().includes('newsletter') || plat.toLowerCase().includes('substack');
    const executionType = isNewsletter ? 'newsletter_draft' : 'blog_draft';

    await db.prepare(`
      INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date, selected_media_asset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, workspaceId, `Publish Article: ${args.title}`, `Stage Content: ${args.content?.substring(0, 50)}...`, assigneeId, 'todo', executionType, draftArtifact, 'Soon', args.mediaAssetId || null);

    return `[SUCCESS] Draft titled '${args.title}' staged for publication on ${args.targetPlatform}. ID: ${taskId}`;
  },
  {
    name: "publish_blog_post",
    description: "REQUIRED TOOL: You MUST use this tool to draft, write, or publish a blog/newsletter to Substack or internal blogs, OR to draft legal documents. Never output conversational drafts in chat, always use this tool so the draft physicaly mounts into their UI calendar. Keywords: plan, draft, write, article, content. The 'mediaAssetId' field should be populated if you generated an image for this post.",
    schema: z.object({ title: z.string(), content: z.string(), targetPlatform: z.string(), mediaAssetId: z.number().optional() })
  }
);

export const updateCrmTool = tool(
  async (lead, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const avatar = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(lead.name)}&backgroundColor=f5f5f4`;
      
      const result = await db.prepare(`
        INSERT INTO leads (workspace_id, name, email, company, role, linkedin_url, avatar, status, source_context, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (workspace_id, email) DO UPDATE SET
          name = EXCLUDED.name,
          company = COALESCE(EXCLUDED.company, leads.company),
          role = COALESCE(EXCLUDED.role, leads.role),
          linkedin_url = COALESCE(EXCLUDED.linkedin_url, leads.linkedin_url),
          source_context = COALESCE(EXCLUDED.source_context, leads.source_context),
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `).run(
        workspaceId,
        lead.name,
        lead.email,
        lead.company || null,
        lead.role || null,
        lead.linkedin_url || null,
        avatar,
        'New Lead',
        lead.reasoning || null
      );

      const leadId = result.lastInsertRowid;

      return `[SUCCESS] Lead ${lead.name} (${lead.email}) processed successfully. ${result.changes > 0 ? 'Record created/updated.' : 'No changes needed.'} LEAD_ID: ${leadId}`;
    } catch (err: any) {
      console.error("update_crm error:", err);
      return `[FAILED] Could not process lead in CRM: ${err.message}`;
    }
  },
  {
    name: "update_crm",
    description: "Add or update a sales prospect in the agency's CRM. This tool automatically handles duplicates by updating existing records with new information. Use this whenever you find a promising lead. Keywords: add lead, new prospect, update crm, save contact, lead enrichment.",
    schema: z.object({ 
      name: z.string().describe("The full name of the prospect."), 
      email: z.string().describe("The contact email address. This is used for deduplication."), 
      company: z.string().optional().describe("The name of the prospect's company."), 
      role: z.string().optional().describe("The job title or role of the prospect."), 
      linkedin_url: z.string().optional().describe("The URL to the prospect's LinkedIn profile."),
      reasoning: z.string().optional().describe("Briefly explain why this lead is a good fit or where you found them.")
    })
  }
);

export const enrollSequenceContactsTool = tool(
  async ({ sequenceId, contactIds, leadEmails }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      let resolvedContactIds = contactIds || [];

      // If lead emails were provided instead of contactIds, resolve them
      if (leadEmails?.length && resolvedContactIds.length === 0) {
        for (const email of leadEmails) {
          // Check local DB for existing zernio_contact_id
          const lead = await db.prepare("SELECT zernio_contact_id, name FROM leads WHERE email = ? AND workspace_id = ?").get(email, workspaceId) as any;
          
          if (lead?.zernio_contact_id) {
            resolvedContactIds.push(lead.zernio_contact_id);
          } else {
            // Create contact in Zernio, then store the ID locally
            try {
              const zConfig = await getZernioConfig();
              if (!zConfig) {
                return `[FAILED] Cannot resolve contact ${email} — Zernio config unavailable. Please sync leads first with sync_leads_to_zernio.`;
              }
              const createRes = await zernioFetch('/contacts', {
                method: 'POST',
                body: JSON.stringify({
                  profileId: zConfig.profileId,
                  name: lead?.name || email.split('@')[0],
                  email: email
                })
              });
              const newContactId = createRes?.contact?.id;
              if (newContactId) {
                resolvedContactIds.push(newContactId);
                // Store back to local lead record
                await db.prepare("UPDATE leads SET zernio_contact_id = ? WHERE email = ? AND workspace_id = ?").run(newContactId, email, workspaceId);
              }
            } catch (cErr: any) {
              console.warn(`Failed to create Zernio contact for ${email}:`, cErr.message);
            }
          }
        }
      }

      if (resolvedContactIds.length === 0) {
        return `[FAILED] No valid Zernio contact IDs could be resolved. Make sure leads are synced to Zernio first (use sync_leads_to_zernio).`;
      }

      // Determine if this is a Zernio sequence or local-only
      const seq = await db.prepare("SELECT zernio_sequence_id FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      const zernioSeqId = seq?.zernio_sequence_id;

      if (zernioSeqId) {
        // Enroll via Zernio API
        const res = await zernioFetch(`/sequences/${zernioSeqId}/enroll`, {
          method: 'POST',
          body: JSON.stringify({ contactIds: resolvedContactIds })
        });
        return `[SUCCESS] ${res?.enrolled || resolvedContactIds.length} contact(s) enrolled in Zernio sequence ${zernioSeqId}. Skipped: ${res?.skipped || 0}.`;
      } else {
        // Local enrollment for daemon-managed sequences
        for (const cId of resolvedContactIds) {
          const lead = await db.prepare("SELECT id FROM leads WHERE zernio_contact_id = ? AND workspace_id = ?").get(cId, workspaceId) as any;
          if (lead) {
            await db.prepare(`
              INSERT INTO sequence_enrollments (workspace_id, lead_id, sequence_id, status)
              VALUES (?, ?, ?, 'Active')
            `).run(workspaceId, lead.id, sequenceId);
          }
        }
        return `[SUCCESS] ${resolvedContactIds.length} contact(s) enrolled in local sequence ${sequenceId}. The daemon will begin processing steps.`;
      }
    } catch (err: any) {
      console.error("enroll_sequence_contacts error:", err);
      return `[FAILED] Could not enroll contacts: ${err.message}`;
    }
  },
  {
    name: "enroll_sequence_contacts",
    description: "Enroll one or more contacts into an outreach sequence. Provide either Zernio contactIds directly, or leadEmails which will be auto-resolved to Zernio contacts (creating them if needed). For Zernio-synced sequences, enrollment is handled server-side. For local sequences, the daemon manages delivery.",
    schema: z.object({ 
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID (from create_sequence) or Zernio sequence ID."),
      contactIds: z.array(z.string()).optional().describe("Zernio contact IDs to enroll directly."),
      leadEmails: z.array(z.string()).optional().describe("Email addresses of leads to enroll. Will be resolved to Zernio contact IDs automatically.")
    })
  }
);

// Keep backward-compatible alias
export const linkedinOutreachTool = enrollSequenceContactsTool;

export const deleteTaskTool = tool(
  async ({ query }, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || '%';
    
    try {
      if (query.trim().toUpperCase() === 'ALL') {
        const result = await db.prepare(`
          DELETE FROM tasks 
          WHERE workspace_id = ? AND assignee_id LIKE ? AND status != 'done' AND execution_type IN ('social_post', 'blog_draft', 'newsletter_draft', 'blog_post')
        `).run(workspaceId, `%${assigneeId}%`);
        return `[SUCCESS] Deleted ${result.changes} draft(s) from the queue.`;
      } else {
        const result = await db.prepare(`
          DELETE FROM tasks 
          WHERE workspace_id = ? AND assignee_id LIKE ? AND status != 'done' AND (title LIKE ? OR description LIKE ?) AND execution_type IN ('social_post', 'blog_draft', 'newsletter_draft', 'blog_post')
        `).run(workspaceId, `%${assigneeId}%`, `%${query}%`, `%${query}%`);
        
        if (result.changes === 0) {
          return `[FAILED] Found no pending drafts matching '${query}'.`;
        }
        return `[SUCCESS] Deleted ${result.changes} draft(s) matching '${query}'.`;
      }
    } catch (err: any) {
      console.error("delete_task error:", err);
      return `[FAILED] Could not delete tasks: ${err.message}`;
    }
  },
  {
    name: "delete_task",
    description: "Delete or clear a scheduled draft, blog post, or social media post. Use this when the user asks to delete a post, clear the queue, or remove a draft. Pass 'ALL' to the query field to delete all pending drafts assigned to you, or provide a specific title or keyword to match a specific draft. Keywords: delete, remove, clear, wipe, drop, cancel.",
    schema: z.object({ query: z.string() })
  }
);

export const writeWorkspaceFileTool = tool(
  async ({ filePath, content }) => {
    try {
      const fullPath = path.join(SHADOW_DIR, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      const commitHash = await ShadowGitServer.commitAction('Autonomous Agent', `Wrote file ${filePath}`);
      return `Successfully wrote file to ${filePath}. Shadow Snapshot Commit created: [${commitHash}]`;
    } catch(e: any) {
      return `Failed to write file: ${e.message}`;
    }
  },
  {
    name: "write_workspace_file",
    description: "Write raw text, code, or markdown into the project's safe local workspace directory.",
    schema: z.object({ filePath: z.string(), content: z.string() })
  }
);

export const getWorkspaceTasksTool = tool(
  async ({}, config) => {
    try {
      const workspaceId = config?.configurable?.workspace_id || config?.configurable?.workspaceId || 1;
      const rows = await db.prepare("SELECT id, title, description, repeat, due_date, status, execution_type FROM tasks WHERE workspace_id = ?").all(workspaceId) as any[];
      if (!rows.length) return "No tasks found in this workspace.";
      return JSON.stringify(rows, null, 2);
    } catch (e: any) {
      return `Failed to get tasks: ${e.message}`;
    }
  },
  {
    name: "get_tasks",
    description: "Get a list of all current tasks in the workspace, including their titles, IDs, due dates, execution types, statuses, and repeat schedules. Use this to find the exact ID of a task a user wants to edit.",
    schema: z.object({})
  }
);

export const updateWorkspaceTaskTool = tool(
  async ({ taskId, repeat, dueDate, title, description }, config) => {
    try {
      if (!config?.configurable?.workspaceId) return "Error: Missing workspaceId in config.";
      const { getAllowedTaskUpdate } = await import('../validators.ts');
      
      const updateData = { repeat, dueDate, title, description };
      Object.keys(updateData).forEach(key => updateData[key as keyof typeof updateData] === undefined && delete updateData[key as keyof typeof updateData]);
      
      const { updates, error } = getAllowedTaskUpdate(updateData);
      if (error || !updates) return `Failed to update task: ${error}`;

      const keys = Object.keys(updates);
      const values = Object.values(updates);
      const dbKeys = keys.map(k => k === "dueDate" ? "due_date" : k);
      const setClause = dbKeys.map((k) => `${k} = ?`).join(", ");

      const sql = `UPDATE tasks SET ${setClause} WHERE id = ? AND workspace_id = ?`;
      const result = await db.prepare(sql).run(...values, taskId, config.configurable.workspaceId);
      
      if (result.changes === 0) return `[FAILED] No task found with ID ${taskId}.`;
      return `[SUCCESS] Task updated successfully with new fields: ${JSON.stringify(updates)}`;
    } catch (e: any) {
      return `Failed to update task: ${e.message}`;
    }
  },
  {
    name: "update_task",
    description: "Update the configuration of an existing task (like schedule or repeat frequency). Use this to adjust when a scheduled or recurring task executes (e.g. changing from 'daily' to 'every 20 minutes').",
    schema: z.object({
      taskId: z.string().describe("The exact ID of the task to update."),
      repeat: z.string().optional().describe("The repeat string, e.g. 'Every 20 minutes', 'Daily', 'Weekly'. Pass an empty string to clear the schedule."),
      dueDate: z.string().optional().describe("MUST use ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ). Use your system prompt LiveContext to calculate this."),
      title: z.string().optional(),
      description: z.string().optional()
    })
  }
);

export const createGenericTaskTool = tool(
  async ({ title, description, dueDate }, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || 'executive-assistant';

    const taskId = `task-${Date.now()}`;
    const draftArtifact = JSON.stringify({
      title: title,
      body: description,
      bullets: [],
      imageUrl: null
    });

    try {
      await db.prepare(`
        INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(taskId, workspaceId, title, description, assigneeId, 'todo', 'generic', draftArtifact, dueDate || null);

      return `[SUCCESS] Created task '${title}' assigned to ${assigneeId}. ID: ${taskId}`;
    } catch (e: any) {
      return `[FAILED] Could not create task: ${e.message}`;
    }
  },
  {
    name: "create_generic_task",
    description: "Create a generic to-do item or reminder. Use this tool when a user asks you to remind them to do something, or if they want to add a standard task to their list. Do NOT use this for drafting social or blog posts.",
    schema: z.object({
      title: z.string(),
      description: z.string(),
      dueDate: z.string().optional().describe("MUST use ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ). Use your system prompt LiveContext to calculate this.")
    })
  }
);

export const manageTaskStatusTool = tool(
  async ({ taskId, status }, config) => {
    try {
      if (!config?.configurable?.workspaceId) return "Error: Missing workspaceId in config.";
      const workspaceId = config.configurable.workspaceId;
      
      const result = await db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND workspace_id = ?").run(status, taskId, workspaceId);
      
      if (result.changes === 0) return `[FAILED] No task found with ID ${taskId}.`;
      return `[SUCCESS] Task ${taskId} status updated to ${status}.`;
    } catch (e: any) {
      return `Failed to update task status: ${e.message}`;
    }
  },
  {
    name: "manage_task_status",
    description: "Update the status of a specific task (e.g. marking it as 'done', 'cancelled', or 'todo'). You need the exact taskId to use this.",
    schema: z.object({
      taskId: z.string().describe("The exact ID of the task to update."),
      status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).describe("The new status for the task.")
    })
  }
);

export const manageCalendarTool = tool(
  async ({ action, eventId, summary, start, end, description, timeMin, timeMax, maxResults = 10 }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Get workspace owner and tokens
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) return "[FAILED] Workspace not found.";

      const tokenRow = await db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. The user must connect it via Settings -> Integrations.";

      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      client.setCredentials({
        access_token: tokenRow.access_token,
        refresh_token: tokenRow.refresh_token,
        expiry_date: tokenRow.expiry_date,
      });

      // 2. Handle token refresh if needed
      if (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000) {
        const { credentials } = await client.refreshAccessToken();
        await db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(
          credentials.access_token,
          credentials.expiry_date,
          workspace.owner_id
        );
        client.setCredentials(credentials);
      }

      const { google } = await import("googleapis");
      const calendar = google.calendar({ version: "v3", auth: client });

      if (action === 'create') {
        if (!summary || !start || !end) {
          return "[FAILED] Missing required fields for creating an event (summary, start, end).";
        }

        const event = {
          summary,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
        };

        const res = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
        });

        return `[SUCCESS] Event created: "${summary}" at ${start}. EVENT_ID: ${res.data.id}`;
      } else if (action === 'update') {
        if (!eventId || (!summary && !start && !end && !description)) {
          return "[FAILED] Missing required fields for updating an event (eventId and at least one field to update).";
        }

        const event: any = {};
        if (summary) event.summary = summary;
        if (description) event.description = description;
        if (start) event.start = { dateTime: start };
        if (end) event.end = { dateTime: end };

        const res = await calendar.events.patch({
          calendarId: 'primary',
          eventId: eventId,
          requestBody: event,
        });

        return `[SUCCESS] Event ${eventId} updated: "${res.data.summary}"`;
      } else if (action === 'delete') {
        if (!eventId) return "[FAILED] Missing eventId for deletion.";
        await calendar.events.delete({
          calendarId: 'primary',
          eventId: eventId,
        });
        return `[SUCCESS] Event ${eventId} deleted.`;
      } else {
        // Default to 'list'
        const res = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || undefined,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const events = res.data.items || [];
        if (events.length === 0) return "No upcoming events found in the specified range.";

        const formatted = events.map(e => {
          const startTime = e.start?.dateTime || e.start?.date;
          return `- ${e.summary} (${startTime}) | ID: ${e.id}`;
        }).join('\n');

        return `Upcoming Calendar Events:\n\n${formatted}`;
      }

    } catch (err: any) {
      console.error("manage_calendar error:", err);
      return `[FAILED] Could not access Google Calendar: ${err.message}`;
    }
  },
  {
    name: "manage_calendar",
    description: "List, create, update, or delete events in the user's Google Calendar. Use 'list' to check availability, 'create' to schedule, 'update' to move/change an event, and 'delete' to remove one. Keywords: schedule, calendar, meeting, event, availability, check time.",
    schema: z.object({
      action: z.enum(['list', 'create', 'update', 'delete']).describe("The action to perform."),
      eventId: z.string().optional().describe("The ID of the event (required for 'update' and 'delete')."),
      summary: z.string().optional().describe("Title of the event."),
      start: z.string().optional().describe("Start time in ISO 8601 format."),
      end: z.string().optional().describe("End time in ISO 8601 format."),
      description: z.string().optional().describe("Optional description for the event."),
      timeMin: z.string().optional().describe("Lower bound (exclusive) for an event's end time to filter by. Defaults to now."),
      timeMax: z.string().optional().describe("Upper bound (exclusive) for an event's start time to filter by."),
      maxResults: z.number().optional().describe("Maximum number of events to return. Default 10.")
    })
  }
);

export const sendSlackMessageTool = tool(
  async ({ channel, text }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const slack = await db.prepare("SELECT bot_token, default_channel FROM slack_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!slack?.bot_token) return "[FAILED] Slack is not connected for this workspace.";

      const targetChannel = channel || slack.default_channel;
      if (!targetChannel) return "[FAILED] No channel provided and no default channel configured.";

      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slack.bot_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: targetChannel,
          text,
        }),
      });

      const data = await response.json() as any;
      if (!data.ok) throw new Error(data.error || "Slack API error");

      return `[SUCCESS] Message sent to Slack channel '${targetChannel}'.`;
    } catch (err: any) {
      console.error("send_slack_message error:", err);
      return `[FAILED] Could not send Slack message: ${err.message}`;
    }
  },
  {
    name: "send_slack_message",
    description: "Send a message to a Slack channel. Use this to notify the team or update a specific channel. Keywords: slack, notify, message channel.",
    schema: z.object({
      channel: z.string().optional().describe("The channel name or ID (e.g. #general). Defaults to the workspace default channel."),
      text: z.string().describe("The message text to send.")
    })
  }
);

export const listSlackChannelsTool = tool(
  async ({}, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const slack = await db.prepare("SELECT bot_token FROM slack_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!slack?.bot_token) return "[FAILED] Slack is not connected.";

      const response = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel", {
        headers: { Authorization: `Bearer ${slack.bot_token}` },
      });

      const data = await response.json() as any;
      if (!data.ok) throw new Error(data.error || "Slack API error");

      const channels = data.channels || [];
      if (channels.length === 0) return "No Slack channels found.";

      return `Available Slack Channels:\n\n${channels.map((c: any) => `- ${c.name} (ID: ${c.id})`).join('\n')}`;
    } catch (err: any) {
      console.error("list_slack_channels error:", err);
      return `[FAILED] Could not list Slack channels: ${err.message}`;
    }
  },
  {
    name: "list_slack_channels",
    description: "List all available Slack channels in the workspace. Use this to find the correct channel name or ID for sending messages.",
    schema: z.object({})
  }
);

export const sendTeamsMessageTool = tool(
  async ({ text, title }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const teams = await db.prepare("SELECT webhook_url FROM teams_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!teams?.webhook_url) return "[FAILED] Microsoft Teams is not connected (webhook URL missing).";

      const payload = title && title.trim()
        ? {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            summary: title.trim(),
            themeColor: "0078D4",
            title: title.trim(),
            text,
          }
        : { text };

      const response = await fetch(teams.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`Teams webhook failed with status ${response.status}`);

      return `[SUCCESS] Message sent to Microsoft Teams.`;
    } catch (err: any) {
      console.error("send_teams_message error:", err);
      return `[FAILED] Could not send Teams message: ${err.message}`;
    }
  },
  {
    name: "send_teams_message",
    description: "Send a message to a Microsoft Teams channel via webhook. Keywords: teams, microsoft teams, notify teams.",
    schema: z.object({
      text: z.string().describe("The message text to send."),
      title: z.string().optional().describe("Optional title/header for the message card.")
    })
  }
);

export const manageNotionTool = tool(
  async ({ action, title, content, parentPageId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const notion = await db.prepare("SELECT integration_token, default_parent_page_id FROM notion_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!notion?.integration_token) return "[FAILED] Notion is not connected for this workspace.";

      const resolvedParentPageId = parentPageId || notion.default_parent_page_id;
      if (!resolvedParentPageId) return "[FAILED] No parent page ID provided and no default parent page configured.";

      if (action === 'create_page') {
        if (!title) return "[FAILED] Title is required to create a Notion page.";

        const response = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notion.integration_token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { page_id: resolvedParentPageId },
            properties: {
              title: {
                title: [{ type: "text", text: { content: title } }],
              },
            },
            ...(content ? {
              children: [{
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [{ type: "text", text: { content } }],
                },
              }],
            } : {}),
          }),
        });

        const data = await response.json() as any;
        if (!response.ok) throw new Error(data.message || "Notion API error");

        return `[SUCCESS] Notion page "${title}" created. PAGE_ID: ${data.id}`;
      }

      return "[FAILED] Unsupported Notion action.";
    } catch (err: any) {
      console.error("manage_notion error:", err);
      return `[FAILED] Could not interact with Notion: ${err.message}`;
    }
  },
  {
    name: "manage_notion",
    description: "Create or manage pages in Notion. Use this to save research, documents, or notes to the agency's Notion workspace. Keywords: notion, save doc, create page, notes.",
    schema: z.object({
      action: z.enum(['create_page']).describe("The action to perform."),
      title: z.string().describe("The title of the Notion page."),
      content: z.string().optional().describe("The text content for the page."),
      parentPageId: z.string().optional().describe("Optional ID of the parent page. Defaults to the workspace default.")
    })
  }
);

/**
 * Twilio helper (adapted from integrationsRoutes)
 */
async function sendTwilioSms(accountSid: string, authToken: string, from: string, to: string, body: string) {
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const payload = new URLSearchParams({ From: from, To: to, Body: body });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Twilio API error: ${response.status}`);
  }

  return response.json() as Promise<{ sid?: string; status?: string }>;
}

export const sendSmsTool = tool(
  async ({ to, body }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const row = await db.prepare("SELECT account_sid, auth_token, from_number FROM twilio_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!row) {
        return "[FAILED] Twilio is not connected. The user must connect it via Settings -> Integrations.";
      }

      const message = await sendTwilioSms(row.account_sid, row.auth_token, row.from_number, to.trim(), body.trim());
      return `[SUCCESS] SMS sent to ${to}. SID: ${message.sid}. Status: ${message.status}`;
    } catch (err: any) {
      console.error("send_sms tool error:", err);
      return `[FAILED] Could not send SMS: ${err.message}`;
    }
  },
  {
    name: "send_sms",
    description: "Send a real SMS message to a phone number. Use this for urgent notifications, lead follow-ups, or meeting reminders. Keywords: sms, text, phone message, send mobile.",
    schema: z.object({ 
      to: z.string().describe("Recipient's phone number in E.164 format (e.g. +15551234567)."), 
      body: z.string().describe("The text message content.") 
    })
  }
);

/**
 * HubSpot Helpers
 */
async function hubspotRequest(apiKey: string, endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.hubapi.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.message || `HubSpot API error: ${response.status}`);
  return data;
}

export const publishHubspotPostTool = tool(
  async ({ title, content, blogId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const row = await db.prepare("SELECT access_token FROM hubspot_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!row?.access_token) return "[FAILED] HubSpot is not connected. Connect it via Settings -> Integrations.";

      // 1. Create the blog post draft
      const post = await hubspotRequest(row.access_token, "/cms/v3/blogs/posts", {
        method: "POST",
        body: JSON.stringify({
          name: title,
          postBody: content,
          contentGroupId: blogId, // Required to specify which blog to post to
          postSummary: content.substring(0, 200) + "..."
        })
      });

      return `[SUCCESS] HubSpot blog draft "${title}" created. POST_ID: ${post.id}. URL: ${post.url}`;
    } catch (err: any) {
      console.error("publish_hubspot_post error:", err);
      return `[FAILED] Could not create HubSpot post: ${err.message}`;
    }
  },
  {
    name: "publish_hubspot_post",
    description: "Create a draft blog post in HubSpot CMS. Use this to stage content for the agency's primary blog. Keywords: hubspot blog, post article, cms draft.",
    schema: z.object({
      title: z.string().describe("The title of the blog post."),
      content: z.string().describe("The HTML or plain text body of the post."),
      blogId: z.string().describe("The HubSpot Blog/Content Group ID.")
    })
  }
);

export const syncHubspotLeadTool = tool(
  async ({ name, email, company }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const row = await db.prepare("SELECT access_token FROM hubspot_connections WHERE workspace_id = ?").get(workspaceId) as any;
      if (!row?.access_token) return "[FAILED] HubSpot is not connected.";

      // 1. Create/Update Contact
      const [firstName, ...lastNameParts] = name.split(" ");
      const contact = await hubspotRequest(row.access_token, "/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            email,
            firstname: firstName,
            lastname: lastNameParts.join(" "),
            company
          }
        })
      }).catch(async (e) => {
        // If conflict (409), try to update instead
        if (e.message.includes("already exists")) {
          return await hubspotRequest(row.access_token, `/crm/v3/objects/contacts/${email}?idProperty=email`, {
            method: "PATCH",
            body: JSON.stringify({ properties: { company } })
          });
        }
        throw e;
      });

      return `[SUCCESS] Lead ${name} synced to HubSpot CRM. CONTACT_ID: ${contact.id}`;
    } catch (err: any) {
      console.error("sync_hubspot_lead error:", err);
      return `[FAILED] Could not sync lead to HubSpot: ${err.message}`;
    }
  },
  {
    name: "sync_hubspot_lead",
    description: "Sync a lead from our local CRM into your HubSpot CRM. Use this to move promising prospects into your primary sales pipeline. Keywords: sync hubspot, export lead, crm sync.",
    schema: z.object({
      name: z.string().describe("Lead's full name."),
      email: z.string().describe("Lead's email address."),
      company: z.string().optional().describe("Lead's company name.")
    })
  }
);

export const listLocalLeadsTool = tool(
  async ({ status, limit = 10 }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      let query = "SELECT name, email, company, role, status, sequence, source_context FROM leads WHERE workspace_id = ?";
      const params: any[] = [workspaceId];

      if (status) {
        query += " AND status = ?";
        params.push(status);
      }

      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const rows = await db.prepare(query).all(...params) as any[];

      if (rows.length === 0) {
        return `No leads found in the local CRM for workspace ${workspaceId}${status ? ` with status '${status}'` : ''}.`;
      }

      const formatted = rows.map(r => 
        `- ${r.name} (${r.email}) | ${r.role || 'No Role'} at ${r.company || 'No Company'}\n  Status: ${r.status} | Sequence: ${r.sequence}\n  Context: ${r.source_context || 'No context saved.'}`
      ).join('\n\n');

      return `Current Local CRM Leads (Total: ${rows.length}):\n\n${formatted}`;
    } catch (err: any) {
      console.error("list_local_leads error:", err);
      return `[FAILED] Could not list local leads: ${err.message}`;
    }
  },
  {
    name: "list_local_leads",
    description: "List the prospects currently stored in the agency's local CRM database. Use this to check who has already been found or to get an update on your pipeline status. Keywords: list leads, show pipeline, current prospects, who did I find.",
    schema: z.object({
      status: z.string().optional().describe("Filter by status (e.g. 'New Lead', 'In Sequence')."),
      limit: z.number().optional().describe("Maximum number of leads to return. Default 10.")
    })
  }
);

export const updateAgentScheduleTool = tool(
  async ({ taskId, repeat, preferredTime }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const nextDate = new Date();
      
      if (repeat.toLowerCase().includes("minute")) {
        const mins = parseInt(repeat.match(/\d+/)?.[0] || "20", 10);
        nextDate.setMinutes(nextDate.getMinutes() + mins);
      } else {
        // 1. Calculate the next execution date based on the preferred time
        const [hours, minutes] = preferredTime.split(':').map(Number);
        nextDate.setHours(hours, minutes, 0, 0);
        
        // If the time has already passed today, set it for tomorrow
        if (nextDate.getTime() <= Date.now()) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
      }

      await db.prepare("UPDATE tasks SET repeat = ?, due_date = ? WHERE id = ? AND workspace_id = ?")
        .run(repeat, nextDate.toISOString(), taskId, workspaceId);

      return `[SUCCESS] Schedule updated for task ${taskId}. Frequency: ${repeat}, Next run: ${nextDate.toLocaleString()}.`;
    } catch (err: any) {
      console.error("update_agent_schedule error:", err);
      return `[FAILED] Could not update schedule: ${err.message}`;
    }
  },
  {
    name: "update_agent_schedule",
    description: "Update the recurring schedule for a specific agent task. Use this when the user specifies how often and at what time they want a major action (like research or triage) to happen. Keywords: set schedule, change time, repeat frequency.",
    schema: z.object({
      taskId: z.string().describe("The ID of the task to update (e.g. 'Daily Research')."),
      repeat: z.string().describe("How often the task should repeat. Can be 'daily', 'weekly', 'weekdays', 'monthly' or a custom value like '20 minutes'."),
      preferredTime: z.string().describe("The time of day in 24-hour format (e.g. '09:00' or '17:30').")
    })
  }
);

/**
 * Helper to fetch and cache Zernio profile/account config.
 * Returns the first available profileId and accountId for the given platform.
 */
async function getZernioConfig(platform: string = 'linkedin'): Promise<{ profileId: string; accountId: string; connectedPlatforms: string[] } | null> {
  try {
    const profilesRes = await zernioFetch('/profiles');
    const profiles = profilesRes?.profiles || profilesRes?.data || [];
    if (!profiles.length) return null;

    const profileId = profiles[0].id;

    const accountsRes = await zernioFetch('/accounts');
    const accounts = accountsRes?.accounts || accountsRes?.data || [];
    
    const connectedPlatforms = [...new Set(accounts.map((a: any) => a.platform))] as string[];
    
    // Find account matching requested platform, fallback to first available
    const matchingAccount = accounts.find((a: any) => a.platform === platform) || accounts[0];
    const accountId = matchingAccount?.id || '';
    const resolvedPlatform = matchingAccount?.platform || platform;

    return { profileId, accountId: accountId, connectedPlatforms };
  } catch (err: any) {
    console.error("getZernioConfig error:", err.message);
    return null;
  }
}

export const createSequenceTool = tool(
  async ({ title, description, platform, steps, syncToZernio, profileId, accountId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    const resolvedPlatform = platform || 'linkedin';
    
    try {
      let zernioSequenceId: string | null = null;
      let resolvedProfileId = profileId || null;
      let resolvedAccountId = accountId || null;

      // If syncing to Zernio, resolve config and create remotely first
      if (syncToZernio !== false) {
        if (!resolvedProfileId || !resolvedAccountId) {
          const zConfig = await getZernioConfig(resolvedPlatform);
          if (zConfig) {
            resolvedProfileId = resolvedProfileId || zConfig.profileId;
            resolvedAccountId = resolvedAccountId || zConfig.accountId;
          }
        }

        if (resolvedProfileId && resolvedAccountId) {
          try {
            const zernioRes = await zernioFetch('/sequences', {
              method: 'POST',
              body: JSON.stringify({
                profileId: resolvedProfileId,
                accountId: resolvedAccountId,
                platform: resolvedPlatform,
                name: title,
                description: description || '',
                steps: steps.map(s => ({
                  order: s.order,
                  delayMinutes: s.delayMinutes,
                  message: { text: s.message.text }
                })),
                exitOnReply: true,
                exitOnUnsubscribe: true
              })
            });
            zernioSequenceId = zernioRes?.sequence?.id || null;
          } catch (zErr: any) {
            console.warn("Zernio sequence sync failed (continuing with local):", zErr.message);
          }
        }
      }

      // Write to local DB
      const result = await db.prepare(`
        INSERT INTO sales_sequences (workspace_id, title, status, schedule, steps, zernio_sequence_id, platform, profile_id, account_id, exit_on_reply, exit_on_unsubscribe)
        VALUES (?, ?, 'Draft', ?, ?, ?, ?, ?, ?, true, true) RETURNING id
      `).get(
        workspaceId, title, 'Runs every day', JSON.stringify(steps),
        zernioSequenceId, resolvedPlatform, resolvedProfileId, resolvedAccountId
      ) as any;
      
      const syncStatus = zernioSequenceId 
        ? `Synced to Zernio (ID: ${zernioSequenceId}). Zernio will manage delivery.` 
        : 'Local only — use activate_sequence to push to Zernio.';
      
      return `[SUCCESS] Sequence "${title}" created with ${steps.length} steps on ${resolvedPlatform}. Local ID: ${result.id}. ${syncStatus}\n\nNext steps: Use activate_sequence to start it, then enroll_sequence_contacts to add leads.`;
    } catch (err: any) {
      console.error("create_sequence error:", err);
      return `[FAILED] Could not create sequence: ${err.message}`;
    }
  },
  {
    name: "create_sequence",
    description: "Create a multi-step outreach sequence. Steps use Zernio's format: each step has an order, delayMinutes (0=immediate, 1440=1 day, 4320=3 days), and a message with text. By default, sequences sync to Zernio for server-side delivery and default to LinkedIn. Use this when the user wants to set up a drip campaign or outreach sequence.",
    schema: z.object({
      title: z.string().describe("The name of the sequence (e.g. 'Welcome Series', 'Cold Outreach Q2')."),
      description: z.string().optional().describe("A brief description of the sequence's purpose."),
      platform: z.enum(['linkedin', 'instagram', 'facebook', 'telegram', 'twitter', 'bluesky', 'reddit', 'whatsapp']).optional().describe("Target platform. Defaults to 'linkedin'. Must be a platform the user has connected in Zernio."),
      profileId: z.string().optional().describe("Zernio profile ID. Auto-detected if not provided."),
      accountId: z.string().optional().describe("Zernio account ID. Auto-detected if not provided."),
      syncToZernio: z.boolean().optional().describe("If true (default), also creates the sequence in Zernio for server-side delivery. Set false for daemon-managed agent-generated sequences."),
      steps: z.array(z.object({
        order: z.number().describe("Step position in the sequence (1-based)."),
        delayMinutes: z.number().describe("Delay in minutes before this step fires after the previous one. 0 = immediate, 1440 = 1 day, 4320 = 3 days, 10080 = 1 week."),
        message: z.object({
          text: z.string().describe("The message text to send to the contact. Write complete, ready-to-send copy.")
        }).describe("The message content for this step.")
      })).describe("Ordered list of timed message steps in the sequence.")
    })
  }
);

export const getSequencesTool = tool(
  async ({}, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const rows = await db.prepare("SELECT id, title, status, schedule FROM sales_sequences WHERE workspace_id = ?").all(workspaceId) as any[];
      if (rows.length === 0) return "No sequences found in this workspace.";
      return `Current Sales Sequences:\n\n${rows.map(r => `- ${r.title} (ID: ${r.id}) | Status: ${r.status}`).join('\n')}`;
    } catch (err: any) {
      console.error("get_sequences error:", err);
      return `[FAILED] Could not fetch sequences: ${err.message}`;
    }
  },
  {
    name: "get_sequences",
    description: "List all sales sequences in the current workspace CRM.",
    schema: z.object({})
  }
);

export const sendPushNotificationTool = tool(
  async ({ title, message, url }, config) => {
    const workspaceId = config?.configurable?.workspace_id || config?.configurable?.workspaceId;
    if (!workspaceId) return '[FAILED] No workspace context for push notification.';
    try {
      const { sendPushToWorkspace } = await import('../notificationSender.js');
      const r = await sendPushToWorkspace(Number(workspaceId), { title, message, url });
      if (r.sent === 0 && r.failed === 0) {
        return '[INFO] No push subscriptions found for this workspace. The user must enable notifications in their browser first.';
      }
      return `[SUCCESS] Push notification sent to ${r.sent} device(s).${r.removed ? ` Removed ${r.removed} stale subscription(s).` : ''}`;
    } catch (err: any) {
      console.error("send_push_notification error:", err);
      return `[FAILED] Could not send push notification: ${err.message}`;
    }
  },
  {
    name: "send_push_notification",
    description: "Send a real-time push notification to the user's browser or mobile device. Use this to proactively alert the user when you complete a major task, find something urgent, or need their immediate attention. The notification appears even when the browser tab is in the background or the screen is locked. Keywords: notify user, alert user, push notification, notify, alert. NOTE: You MUST ALWAYS provide the `url` parameter formatted as `/?agent={your_agent_id}` so the user is taken directly to your chat interface when they click the notification.",
    schema: z.object({
      title: z.string().describe("Short notification title (max 50 chars)."),
      message: z.string().describe("Notification body text describing what happened (max 150 chars)."),
      url: z.string().optional().describe("URL to open when the user clicks the notification. REQUIRED: must be formatted as '/?agent=your_agent_id'.")
    })
  }
);

export const activateSequenceTool = tool(
  async ({ sequenceId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const seq = await db.prepare("SELECT zernio_sequence_id, title FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      if (!seq) return `[FAILED] Sequence ${sequenceId} not found.`;

      if (seq.zernio_sequence_id) {
        await zernioFetch(`/sequences/${seq.zernio_sequence_id}/activate`, { method: 'POST' });
      }
      await db.prepare("UPDATE sales_sequences SET status = 'Active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sequenceId);
      return `[SUCCESS] Sequence "${seq.title}" is now active.${seq.zernio_sequence_id ? ' Zernio will begin processing enrolled contacts.' : ' The local daemon will process steps.'}`;
    } catch (err: any) {
      console.error("activate_sequence error:", err);
      return `[FAILED] Could not activate sequence: ${err.message}`;
    }
  },
  {
    name: "activate_sequence",
    description: "Activate a draft or paused sequence. For Zernio-synced sequences, this starts server-side delivery. For local sequences, the daemon begins processing. The sequence must have at least one step.",
    schema: z.object({
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID to activate.")
    })
  }
);

export const pauseSequenceTool = tool(
  async ({ sequenceId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const seq = await db.prepare("SELECT zernio_sequence_id, title FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      if (!seq) return `[FAILED] Sequence ${sequenceId} not found.`;

      if (seq.zernio_sequence_id) {
        await zernioFetch(`/sequences/${seq.zernio_sequence_id}/pause`, { method: 'POST' });
      }
      await db.prepare("UPDATE sales_sequences SET status = 'Paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sequenceId);
      return `[SUCCESS] Sequence "${seq.title}" is now paused. Enrolled contacts will stop receiving messages until reactivated.`;
    } catch (err: any) {
      console.error("pause_sequence error:", err);
      return `[FAILED] Could not pause sequence: ${err.message}`;
    }
  },
  {
    name: "pause_sequence",
    description: "Pause an active sequence. Enrolled contacts stop receiving messages until the sequence is reactivated with activate_sequence.",
    schema: z.object({
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID to pause.")
    })
  }
);

export const getSequenceAnalyticsTool = tool(
  async ({ sequenceId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const seq = await db.prepare("SELECT * FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      if (!seq) return `[FAILED] Sequence ${sequenceId} not found.`;

      let analytics: any = {
        localId: seq.id,
        title: seq.title,
        status: seq.status,
        platform: seq.platform || 'unknown',
        steps: JSON.parse(seq.steps || '[]'),
        localEnrollments: { active: 0, completed: 0, failed: 0 }
      };

      // Count local enrollments
      const enrollments = await db.prepare(`
        SELECT status, COUNT(*) as count FROM sequence_enrollments 
        WHERE sequence_id = ? AND workspace_id = ? GROUP BY status
      `).all(sequenceId, workspaceId) as any[];
      for (const e of enrollments) {
        if (e.status === 'Active') analytics.localEnrollments.active = e.count;
        else if (e.status === 'Completed') analytics.localEnrollments.completed = e.count;
        else if (e.status === 'Failed') analytics.localEnrollments.failed = e.count;
      }

      // If Zernio-synced, fetch remote stats
      if (seq.zernio_sequence_id) {
        try {
          const zernioData = await zernioFetch(`/sequences/${seq.zernio_sequence_id}`);
          const zSeq = zernioData?.sequence || zernioData;
          analytics.zernio = {
            id: seq.zernio_sequence_id,
            totalEnrolled: zSeq.totalEnrolled || 0,
            totalCompleted: zSeq.totalCompleted || 0,
            totalExited: zSeq.totalExited || 0,
            status: zSeq.status || 'unknown',
            steps: zSeq.steps || []
          };
          // Calculate performance metrics
          const enrolled = zSeq.totalEnrolled || 0;
          if (enrolled > 0) {
            analytics.performance = {
              completionRate: `${Math.round(((zSeq.totalCompleted || 0) / enrolled) * 100)}%`,
              exitRate: `${Math.round(((zSeq.totalExited || 0) / enrolled) * 100)}%`,
              activeRate: `${Math.round(((enrolled - (zSeq.totalCompleted || 0) - (zSeq.totalExited || 0)) / enrolled) * 100)}%`
            };
          }
        } catch (zErr: any) {
          analytics.zernio = { error: `Could not fetch from Zernio: ${zErr.message}` };
        }
      }

      // Fetch recent events
      const events = await db.prepare(`
        SELECT * FROM sequence_events WHERE sequence_id = ? AND workspace_id = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(sequenceId, workspaceId) as any[];
      analytics.recentEvents = events;

      return `[SEQUENCE ANALYTICS]\n${JSON.stringify(analytics, null, 2)}`;
    } catch (err: any) {
      console.error("get_sequence_analytics error:", err);
      return `[FAILED] Could not fetch analytics: ${err.message}`;
    }
  },
  {
    name: "get_sequence_analytics",
    description: "Get detailed performance analytics for a sequence including enrollment counts, completion/exit rates, step details, and recent events. Use this to assess how a sequence is performing and decide whether to optimize, pause, or expand enrollment.",
    schema: z.object({
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID to get analytics for.")
    })
  }
);

export const updateSequenceTool = tool(
  async ({ sequenceId, name, description, steps, exitOnReply, exitOnUnsubscribe }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const seq = await db.prepare("SELECT * FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      if (!seq) return `[FAILED] Sequence ${sequenceId} not found.`;

      // Build update payload for Zernio
      if (seq.zernio_sequence_id) {
        const updateBody: any = {};
        if (name) updateBody.name = name;
        if (description) updateBody.description = description;
        if (steps) updateBody.steps = steps.map(s => ({
          order: s.order,
          delayMinutes: s.delayMinutes,
          message: { text: s.message.text }
        }));
        if (exitOnReply !== undefined) updateBody.exitOnReply = exitOnReply;
        if (exitOnUnsubscribe !== undefined) updateBody.exitOnUnsubscribe = exitOnUnsubscribe;

        await zernioFetch(`/sequences/${seq.zernio_sequence_id}`, {
          method: 'PATCH',
          body: JSON.stringify(updateBody)
        });
      }

      // Update local DB
      const updates: string[] = [];
      const values: any[] = [];
      if (name) { updates.push("title = ?"); values.push(name); }
      if (steps) { updates.push("steps = ?"); values.push(JSON.stringify(steps)); }
      if (exitOnReply !== undefined) { updates.push("exit_on_reply = ?"); values.push(exitOnReply); }
      if (exitOnUnsubscribe !== undefined) { updates.push("exit_on_unsubscribe = ?"); values.push(exitOnUnsubscribe); }
      updates.push("updated_at = CURRENT_TIMESTAMP");
      values.push(sequenceId);

      await db.prepare(`UPDATE sales_sequences SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      return `[SUCCESS] Sequence "${name || seq.title}" updated.${seq.zernio_sequence_id ? ' Changes are live on Zernio — active enrollments will use the updated steps.' : ''}`;
    } catch (err: any) {
      console.error("update_sequence error:", err);
      return `[FAILED] Could not update sequence: ${err.message}`;
    }
  },
  {
    name: "update_sequence",
    description: "Update an existing sequence's name, steps, or exit conditions. For Zernio-synced sequences, changes are applied remotely without pausing. Use this to optimize underperforming steps by rewriting message content or adjusting delays.",
    schema: z.object({
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID to update."),
      name: z.string().optional().describe("New name for the sequence."),
      description: z.string().optional().describe("New description."),
      steps: z.array(z.object({
        order: z.number(),
        delayMinutes: z.number(),
        message: z.object({ text: z.string() })
      })).optional().describe("Replacement steps (all steps must be provided, not partial)."),
      exitOnReply: z.boolean().optional(),
      exitOnUnsubscribe: z.boolean().optional()
    })
  }
);

export const syncLeadsToZernioTool = tool(
  async ({ leadIds }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const zConfig = await getZernioConfig();
      if (!zConfig) return `[FAILED] Could not connect to Zernio. Check your API key.`;

      // Fetch leads that don't have a zernio_contact_id yet
      let leads: any[];
      if (leadIds?.length) {
        const placeholders = leadIds.map(() => '?').join(',');
        leads = await db.prepare(
          `SELECT * FROM leads WHERE id IN (${placeholders}) AND zernio_contact_id IS NULL`
        ).all(...leadIds) as any[];
      } else {
        leads = await db.prepare(
          "SELECT * FROM leads WHERE zernio_contact_id IS NULL LIMIT 50"
        ).all() as any[];
      }

      if (!leads.length) return '[INFO] All leads are already synced to Zernio.';

      let synced = 0, failed = 0;
      for (const lead of leads) {
        try {
          const res = await zernioFetch('/contacts', {
            method: 'POST',
            body: JSON.stringify({
              profileId: zConfig.profileId,
              name: lead.name,
              email: lead.email || undefined,
              linkedinUrl: lead.linkedin_url || undefined
            })
          });
          const contactId = res?.contact?.id;
          if (contactId) {
            await db.prepare("UPDATE leads SET zernio_contact_id = ? WHERE id = ?").run(contactId, lead.id);
            synced++;
          } else {
            failed++;
          }
        } catch (cErr: any) {
          console.warn(`Failed to sync lead ${lead.name}:`, cErr.message);
          failed++;
        }
      }

      return `[SUCCESS] Synced ${synced} lead(s) to Zernio contacts. Failed: ${failed}. These leads can now be enrolled in sequences by contact ID.`;
    } catch (err: any) {
      console.error("sync_leads_to_zernio error:", err);
      return `[FAILED] Could not sync leads: ${err.message}`;
    }
  },
  {
    name: "sync_leads_to_zernio",
    description: "Proactively push local CRM leads to Zernio's contact system so they can be enrolled in sequences. This creates Zernio contacts and stores the contact IDs locally. Call this before enrolling leads in sequences. If no leadIds are specified, syncs all un-synced leads (up to 50).",
    schema: z.object({
      leadIds: z.array(z.number()).optional().describe("Specific local lead IDs to sync. If omitted, syncs all un-synced leads.")
    })
  }
);

export const unenrollContactTool = tool(
  async ({ sequenceId, leadId, reason }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const enrollment = await db.prepare(
        "SELECT e.id, e.status, s.zernio_sequence_id, s.title, l.name as lead_name, l.zernio_contact_id FROM sequence_enrollments e JOIN sales_sequences s ON e.sequence_id = s.id JOIN leads l ON e.lead_id = l.id WHERE e.sequence_id = ? AND e.lead_id = ? AND e.workspace_id = ?"
      ).get(sequenceId, leadId, workspaceId) as any;

      if (!enrollment) return `[FAILED] No enrollment found for lead ${leadId} in sequence ${sequenceId}.`;

      // Remove from Zernio if synced
      if (enrollment.zernio_sequence_id && enrollment.zernio_contact_id) {
        try {
          await zernioFetch(`/sequences/${enrollment.zernio_sequence_id}/contacts/${enrollment.zernio_contact_id}`, {
            method: 'DELETE'
          });
        } catch (zErr: any) {
          console.warn(`Zernio unenroll failed (non-blocking): ${zErr.message}`);
        }
      }

      // Update local enrollment status
      await db.prepare(
        "UPDATE sequence_enrollments SET status = 'Unenrolled' WHERE id = ?"
      ).run(enrollment.id);

      // Log the event
      await db.prepare(
        "INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(workspaceId, leadId, sequenceId, 'Unenrolled', `Reason: ${reason || 'Manual unenroll'}`, 'Agent-initiated unenrollment.');

      return `[SUCCESS] Lead "${enrollment.lead_name}" unenrolled from sequence "${enrollment.title}". Reason: ${reason || 'Not specified'}.`;
    } catch (err: any) {
      console.error("unenroll_contact error:", err);
      return `[FAILED] Could not unenroll contact: ${err.message}`;
    }
  },
  {
    name: "unenroll_contact",
    description: "Remove a specific lead from an active sequence. Use when a lead replies negatively, requests to stop, or when you need to manually remove them from a drip campaign. Updates both local and Zernio enrollment status.",
    schema: z.object({
      sequenceId: z.union([z.string(), z.number()]).describe("The local sequence ID."),
      leadId: z.union([z.string(), z.number()]).describe("The local lead ID to unenroll."),
      reason: z.string().optional().describe("Why this contact is being unenrolled (e.g., 'replied positively', 'requested stop', 'bounced').")
    })
  }
);

export const allTools = [
  queryBrainTool,
  writeToMemoryTool,
  searchGoogleDriveTool,
  listEmailsTool,
  draftEmailTool,
  readGoogleChatTool,
  searchWebTool,
  readWebsiteTool,
  generateImageTool,
  scheduleSocialPostTool,
  draftSocialPostTool,
  publishBlogPostTool,
  updateCrmTool,
  enrollSequenceContactsTool,
  linkedinOutreachTool,
  createSequenceTool,
  getSequencesTool,
  activateSequenceTool,
  pauseSequenceTool,
  getSequenceAnalyticsTool,
  updateSequenceTool,
  syncLeadsToZernioTool,
  unenrollContactTool,
  deleteTaskTool,
  writeWorkspaceFileTool,
  getWorkspaceTasksTool,
  updateWorkspaceTaskTool,
  createGenericTaskTool,
  manageTaskStatusTool,
  manageCalendarTool,
  sendSlackMessageTool,
  listSlackChannelsTool,
  sendTeamsMessageTool,
  manageNotionTool,
  sendSmsTool,
  publishHubspotPostTool,
  syncHubspotLeadTool,
  listLocalLeadsTool,
  updateAgentScheduleTool,
  sendPushNotificationTool
];
