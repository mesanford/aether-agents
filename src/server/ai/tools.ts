import { tool } from "@langchain/core/tools";
import { GoogleGenAI } from '@google/genai';
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ShadowGitServer } from '../lib/git/shadow';

const SHADOW_DIR = path.resolve(process.cwd(), '.shadow-workspace');

export const queryBrainTool = tool(
  async ({ query }) => {
    return "Search failed. Memory integration pending.";
  },
  {
    name: "query_brain",
    description: "Search the company's internal agency brain, knowledge base, policies, and semantic context. Keywords: knowledge, vector, search, find, memory, context, policies, files, documents, drive, read, list docs.",
    schema: z.object({ query: z.string() })
  }
);

export const searchGoogleDriveTool = tool(
  async ({ query }, config) => {
    if (!config?.configurable?.workspaceId) return "Error: Missing workspaceId in config.";
    try {
      const db = new Database('./crm.db');
      const workspace = db.prepare('SELECT google_refresh_token, google_folder_id FROM workspaces WHERE id = ?').get(config.configurable.workspaceId) as any;
      
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
  async ({ to, subject, body }) => {
    return `[GMAIL MOCK] Draft saved successfully for ${to} regarding "${subject}".`;
  },
  {
    name: "draft_email",
    description: "Draft an email response via Gmail. Eva can use this to stage responses.",
    schema: z.object({ to: z.string(), subject: z.string(), body: z.string() })
  }
);

export const readGoogleChatTool = tool(
  async ({ space, limit }) => {
    return `[GCAT MOCK] Read recent messages in space '${space}'. No urgent alerts flagged.`;
  },
  {
    name: "read_google_chat",
    description: "Read recent messages from Google Chat spaces.",
    schema: z.object({ space: z.string(), limit: z.number().optional() })
  }
);

export const searchWebTool = tool(
  async ({ query }) => `[MOCK WEB RESULT] Scraped top 3 articles for ${query}.`,
  {
    name: "search_web",
    description: "Search the public internet for articles, trends, or keyword research.",
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
          
          const db = new Database('./crm.db');
          const insertResult = db.prepare(`
            INSERT INTO media_assets (workspace_id, name, type, category, thumbnail, size, author)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(workspaceId, `AI Generation: ${prompt.substring(0, 30)}...`, 'image', 'generated', dataUrl, 'Unknown', threadId.includes('social-media-manager') ? 'Sonny' : 'Penny');
          mediaAssetId = insertResult.lastInsertRowid;
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
    
    const db = new Database('./crm.db');
    
    let fetchedImageUrl = null;
    if (args.mediaAssetId) {
      try {
        const media = db.prepare('SELECT thumbnail FROM media_assets WHERE id = ?').get(args.mediaAssetId) as any;
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
    db.prepare(`
      INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date, selected_media_asset_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, workspaceId, `Social Drop on ${args.platform}`, `Stage Content: ${args.content?.substring(0, 50)}...`, assigneeId, 'todo', 'social_post', draftArtifact, args.date || 'Soon', args.mediaAssetId || null);

    return `[SUCCESS] Scheduled to ${args.platform} for ${args.date}. Content queued for Task Engine execution. ID: ${taskId}`;
  },
  {
    name: "schedule_social_post",
    description: "REQUIRED TOOL: You MUST use this tool to create drafts, plan, organize, or schedule a post. Do not output conversational drafts. Use this tool so the post physically saves to their calendar. Keywords: plan, draft, write, organize, queue, strategy, social. The 'content' field must be the COMPLETE, fully-written post text including all body copy, emojis, and hashtags exactly as it should appear when published. The 'mediaAssetId' field should be populated if you generated an image for this post.",
    schema: z.object({ platform: z.string(), content: z.string(), date: z.string().optional(), mediaAssetId: z.number().optional() })
  }
);

export const publishBlogPostTool = tool(
  async (args, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || 'blog-writer';
    
    const db = new Database('./crm.db');
    
    let fetchedImageUrl = null;
    if (args.mediaAssetId) {
      try {
        const media = db.prepare('SELECT thumbnail FROM media_assets WHERE id = ?').get(args.mediaAssetId) as any;
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

    db.prepare(`
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
  async (lead) => {
    return `[SUCCESS] Lead ${lead.name} added to CRM Database successfully.`;
  },
  {
    name: "update_crm",
    description: "Update the SQLite Leads CRM with client interactions.",
    schema: z.object({ name: z.string(), email: z.string(), company: z.string().optional(), role: z.string().optional(), linkedin_url: z.string().optional() })
  }
);

export const linkedinOutreachTool = tool(
  async ({ sequenceId, leadName }) => {
     return `[SUCCESS] Lead ${leadName} successfully enrolled into outbound sequence ${sequenceId}.`;
  },
  {
    name: "linkedin_outreach",
    description: "Enroll a prospect into an automated LinkedIn or Email sequence.",
    schema: z.object({ sequenceId: z.string(), leadName: z.string() })
  }
);

export const deleteTaskTool = tool(
  async ({ query }, config) => {
    if (!config?.configurable?.thread_id) return `[FAILED] Missing conversation thread context.`;
    
    const threadId = config.configurable.thread_id as string;
    const workspaceId = config.configurable?.workspace_id || 1;
    const assigneeId = threadId.replace('thread_', '').split('_')[1] || '%';
    
    const db = new Database('./crm.db');
    
    try {
      if (query.trim().toUpperCase() === 'ALL') {
        const result = db.prepare(`
          DELETE FROM tasks 
          WHERE workspace_id = ? AND assignee_id LIKE ? AND status != 'done' AND execution_type IN ('social_post', 'blog_draft', 'newsletter_draft', 'blog_post')
        `).run(workspaceId, `%${assigneeId}%`);
        return `[SUCCESS] Deleted ${result.changes} draft(s) from the queue.`;
      } else {
        const result = db.prepare(`
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
  writeWorkspaceFileTool
];
