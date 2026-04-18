import { tool } from "@langchain/core/tools";
import { GoogleGenAI } from '@google/genai';
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import db from '../db.ts';
import { ShadowGitServer } from '../lib/git/shadow';

const SHADOW_DIR = path.resolve(process.cwd(), '.shadow-workspace');

export const queryBrainTool = tool(
  async ({ query }, config) => {
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

      // 2. Search Stan's Memory (Lessons Learned)
      const lessons = await db.prepare(`
        SELECT learning, confidence_score
        FROM stan_memory_ledger
        WHERE workspace_id = ?
        AND learning ILIKE ?
        ORDER BY confidence_score DESC
        LIMIT 3
      `).all(workspaceId, `%${query}%`) as any[];

      if (docs.length === 0 && lessons.length === 0) {
        return `No internal knowledge found matching '${query}' in workspace ${workspaceId}.`;
      }

      let result = `Internal Knowledge results for '${query}':\n\n`;

      if (docs.length > 0) {
        result += `--- COMPANY DOCUMENTS ---\n`;
        result += docs.map(d => `Title: ${d.title}\nAuthor: ${d.author || 'Agency'}\nContent: ${d.content}`).join('\n\n');
        result += `\n\n`;
      }

      if (lessons.length > 0) {
        result += `--- LESSONS LEARNED (Stan's Memory) ---\n`;
        result += lessons.map(l => `- [Confidence: ${l.confidence_score}%] ${l.learning}`).join('\n');
      }

      return result;
    } catch (err: any) {
      console.error("query_brain error:", err);
      return `Failed to query agency brain: ${err.message}`;
    }
  },
  {
    name: "query_brain",
    description: "Search the company's internal agency brain, knowledge base, policies, and semantic context. Use this to find company-specific rules, project backgrounds, or lessons learned from previous tasks. Keywords: knowledge, policies, find info, project context, lessons learned.",
    schema: z.object({ query: z.string() })
  }
);

export const searchGoogleDriveTool = tool(
  async ({ query }, config) => {
    if (!config?.configurable?.workspaceId) return "Error: Missing workspaceId in config.";
    try {
      const workspace = await db.prepare('SELECT google_refresh_token, google_folder_id FROM workspaces WHERE id = ?').get(config.configurable.workspaceId) as any;
      
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

export const draftEmailTool = tool(
  async ({ to, subject, body }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Get workspace owner and tokens
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) return "[FAILED] Workspace not found.";

      const tokenRow = await db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. The user must connect it via Settings -> Integrations.";

      const { OAuth2Client } = await import("google-auth-library");
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

      const { OAuth2Client } = await import("google-auth-library");
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

export const generateImageTool = tool(
  async ({ prompt, style }, config) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: `${prompt} ${style ? `in a ${style} style` : ''}`,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
        }
      });
      
      if (response.generatedImages && response.generatedImages.length > 0) {
        const base64 = response.generatedImages[0].image.imageBytes;
        const dataUrl = `data:image/jpeg;base64,${base64}`;
        let mediaAssetId = null;
        
        if (config?.configurable?.thread_id) {
          const threadId = config.configurable.thread_id as string;
          const workspaceId = config.configurable?.workspace_id || 1;
          
          const insertResult = await db.prepare(`
            INSERT INTO media_assets (workspace_id, name, type, category, thumbnail, size, author)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
          `).get(workspaceId, `AI Generation: ${prompt.substring(0, 30)}...`, 'image', 'generated', dataUrl, 'Unknown', threadId.includes('social-media-manager') ? 'Sonny' : 'Penny') as any;
          mediaAssetId = insertResult.id;
        }
        
        return `[IMAGE GENERATED] Visual for '${prompt}' created. MEDIA_ASSET_ID: ${mediaAssetId || 'unknown'}`;
      }
      return `[IMAGE GENERATION FAILED] No image returned.`;
    } catch (err: any) {
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
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context needed to associate this post.`;
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || 'social-media-manager';
    
    let fetchedImageUrl = null;
    if (args.mediaAssetId) {
      try {
        const media = await db.prepare('SELECT thumbnail FROM media_assets WHERE id = ?').get(args.mediaAssetId) as any;
        if (media?.thumbnail) fetchedImageUrl = media.thumbnail;
      } catch (err) {
        console.error("Failed to load media asset for social post", err);
      }
    }

    const draftArtifact = JSON.stringify({
      title: `Draft: ${args.platform} Post`,
      body: args.content,
      bullets: [`Target: ${args.platform}`],
      imageUrl: fetchedImageUrl
    });

    const taskId = `task-${Date.now()}`;
    await db.prepare(`
      INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date, selected_media_asset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, workspaceId, `Social Drop on ${args.platform}`, `Stage Content: ${args.content?.substring(0, 50)}...`, assigneeId, 'todo', 'social_post', draftArtifact, args.date || 'Soon', args.mediaAssetId || null);

    return `[SUCCESS] Scheduled to ${args.platform} for ${args.date}. Content queued for Task Engine execution. ID: ${taskId}`;
  },
  {
    name: "schedule_social_post",
    description: "REQUIRED TOOL: You MUST use this tool to create drafts, plan, organize, or schedule a post. Do not output conversational drafts. Use this tool so the post physically saves to their calendar. Keywords: plan, draft, write, organize, queue, strategy, social. The 'content' field must be the COMPLETE, fully-written post text including all body copy, emojis, and hashtags exactly as it should appear when published. The 'mediaAssetId' field should be populated if you generated an image for this post. The 'date' field MUST be in ISO 8601 format.",
    schema: z.object({ 
      platform: z.string(), 
      content: z.string(), 
      date: z.string().optional().describe("MUST use ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ). Use your system prompt LiveContext to calculate this."), 
      mediaAssetId: z.number().optional() 
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
    description: "REQUIRED TOOL: You MUST use this tool to draft, write, or publish a blog/newsletter to Substack or internal blogs. Never output conversational drafts in chat, always use this tool so the draft physicaly mounts into their UI calendar. Keywords: plan, draft, write, article, content. The 'mediaAssetId' field should be populated if you generated an image for this post.",
    schema: z.object({ title: z.string(), content: z.string(), targetPlatform: z.string(), mediaAssetId: z.number().optional() })
  }
);

export const updateCrmTool = tool(
  async (lead, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    try {
      const avatar = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(lead.name)}&backgroundColor=f5f5f4`;
      
      const result = await db.prepare(`
        INSERT INTO leads (workspace_id, name, email, company, role, linkedin_url, avatar, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `).run(
        workspaceId,
        lead.name,
        lead.email,
        lead.company || null,
        lead.role || null,
        lead.linkedin_url || null,
        avatar,
        'New Lead'
      );

      const leadId = result.lastInsertRowid;

      return `[SUCCESS] Lead ${lead.name} added to CRM Database successfully for workspace ${workspaceId}. LEAD_ID: ${leadId}`;
    } catch (err: any) {
      console.error("update_crm error:", err);
      return `[FAILED] Could not add lead to CRM: ${err.message}`;
    }
  },
  {
    name: "update_crm",
    description: "Update the CRM by adding a new lead. Use this tool when you find a new sales prospect that should be tracked in the agency's pipeline. Keywords: add lead, new prospect, update crm, save contact.",
    schema: z.object({ 
      name: z.string().describe("The full name of the prospect."), 
      email: z.string().describe("The contact email address."), 
      company: z.string().optional().describe("The name of the prospect's company."), 
      role: z.string().optional().describe("The job title or role of the prospect."), 
      linkedin_url: z.string().optional().describe("The URL to the prospect's LinkedIn profile.") 
    })
  }
);

export const linkedinOutreachTool = tool(
  async ({ sequenceId, leadName, leadId }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Find the sequence
      let sequence;
      if (Number.isInteger(Number(sequenceId))) {
        sequence = await db.prepare("SELECT id, title FROM sales_sequences WHERE id = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      } else {
        sequence = await db.prepare("SELECT id, title FROM sales_sequences WHERE title = ? AND workspace_id = ?").get(sequenceId, workspaceId) as any;
      }

      if (!sequence) {
        return `[FAILED] Sequence '${sequenceId}' not found in workspace ${workspaceId}.`;
      }

      // 2. Find the lead
      let lead;
      if (leadId) {
        lead = await db.prepare("SELECT id, name FROM leads WHERE id = ? AND workspace_id = ?").get(leadId, workspaceId) as any;
      } else if (leadName) {
        lead = await db.prepare("SELECT id, name FROM leads WHERE name = ? AND workspace_id = ?").get(leadName, workspaceId) as any;
      }

      if (!lead) {
        return `[FAILED] Lead '${leadId || leadName}' not found in workspace ${workspaceId}.`;
      }

      // 3. Check for existing enrollment
      const existing = await db.prepare("SELECT id FROM sequence_enrollments WHERE lead_id = ? AND sequence_id = ? AND workspace_id = ?").get(lead.id, sequence.id, workspaceId);
      if (existing) {
        return `[ALREADY ENROLLED] Lead ${lead.name} is already enrolled in sequence '${sequence.title}'.`;
      }

      // 4. Enroll
      await db.prepare(`
        INSERT INTO sequence_enrollments (workspace_id, lead_id, sequence_id, status, current_step_idx)
        VALUES (?, ?, ?, 'Active', 0)
      `).run(workspaceId, lead.id, sequence.id);

      // 5. Update lead status
      await db.prepare("UPDATE leads SET status = 'In Sequence', sequence = ? WHERE id = ?").run(sequence.title, lead.id);

      return `[SUCCESS] Lead ${lead.name} successfully enrolled into outbound sequence '${sequence.title}'.`;
    } catch (err: any) {
      console.error("linkedin_outreach error:", err);
      return `[FAILED] Could not enroll lead: ${err.message}`;
    }
  },
  {
    name: "linkedin_outreach",
    description: "Enroll a prospect into an automated LinkedIn or Email sequence. Use this to start the agency's automated outreach process for a specific lead. Keywords: start sequence, enroll lead, outreach, automate contact.",
    schema: z.object({ 
      sequenceId: z.string().describe("The ID or exact title of the sequence to enroll them in."), 
      leadName: z.string().optional().describe("The name of the lead to enroll (if leadId is unknown)."),
      leadId: z.number().optional().describe("The database ID of the lead (preferred).")
    })
  }
);

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
      if (!config?.configurable?.workspaceId) return "Error: Missing workspaceId in config.";
      const rows = await db.prepare("SELECT id, title, description, repeat, due_date, status, execution_type FROM tasks WHERE workspace_id = ?").all(config.configurable.workspaceId) as any[];
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
  async ({ action, summary, start, end, description, timeMin, timeMax, maxResults = 10 }, config) => {
    const workspaceId = config?.configurable?.workspace_id || 1;
    
    try {
      // 1. Get workspace owner and tokens
      const workspace = await db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
      if (!workspace) return "[FAILED] Workspace not found.";

      const tokenRow = await db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(workspace.owner_id) as any;
      if (!tokenRow) return "[FAILED] Google account not connected. The user must connect it via Settings -> Integrations.";

      const { OAuth2Client } = await import("google-auth-library");
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
          const start = e.start?.dateTime || e.start?.date;
          return `- ${e.summary} (${start})`;
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
    description: "List or create events in the user's Google Calendar. Use 'list' to check availability or 'create' to schedule something. Keywords: schedule, calendar, meeting, event, availability, check time.",
    schema: z.object({
      action: z.enum(['list', 'create']).describe("The action to perform."),
      summary: z.string().optional().describe("Title of the event (required for 'create')."),
      start: z.string().optional().describe("Start time in ISO 8601 format (required for 'create')."),
      end: z.string().optional().describe("End time in ISO 8601 format (required for 'create')."),
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

export const allTools = [
  queryBrainTool,
  searchGoogleDriveTool,
  draftEmailTool,
  readGoogleChatTool,
  searchWebTool,
  generateImageTool,
  scheduleSocialPostTool,
  publishBlogPostTool,
  updateCrmTool,
  linkedinOutreachTool,
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
  manageNotionTool
];
