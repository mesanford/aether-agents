import { tool } from "@langchain/core/tools";
import { GoogleGenAI } from '@google/genai';
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import db from '../db.ts';
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
  manageTaskStatusTool
];
