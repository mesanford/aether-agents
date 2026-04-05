import express from "express";
import { GoogleGenAI } from "@google/genai";
import type { AuthenticatedRequest, ConnectedServices, LiveContext } from "../types.ts";

type RegisterAiRoutesArgs = {
  app: express.Application;
  aiClient: GoogleGenAI | null;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
  aiRateLimiter: express.RequestHandler;
  isNonEmptyString: (value: unknown) => value is string;
  buildDataAccessSection: (connectedServices?: ConnectedServices) => string;
  buildLiveDataSection: (liveContext?: LiveContext) => string;
};

export function registerAiRoutes({
  app,
  aiClient,
  requireAuth,
  requireWorkspaceAccess,
  aiRateLimiter,
  isNonEmptyString,
  buildDataAccessSection,
  buildLiveDataSection,
}: RegisterAiRoutesArgs) {
  app.post("/api/workspaces/:id/ai/respond", requireAuth, requireWorkspaceAccess, aiRateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const {
        role,
        message,
        context = "",
        canGenerateImage = false,
        liveContext,
        connectedServices,
      } = req.body as {
        role?: string;
        message?: string;
        context?: string;
        canGenerateImage?: boolean;
        liveContext?: LiveContext;
        connectedServices?: ConnectedServices;
      };

      if (!isNonEmptyString(role) || !isNonEmptyString(message)) {
        return res.status(400).json({ error: "role and message are required" });
      }

      if (message.length > 4000) {
        return res.status(400).json({ error: "message exceeds 4000 characters" });
      }

      if (typeof context === "string" && context.length > 12000) {
        return res.status(400).json({ error: "context exceeds 12000 characters" });
      }

      if (Array.isArray(liveContext?.emails) && liveContext.emails.length > 50) {
        return res.status(400).json({ error: "liveContext.emails exceeds 50 items" });
      }

      if (Array.isArray(liveContext?.events) && liveContext.events.length > 50) {
        return res.status(400).json({ error: "liveContext.events exceeds 50 items" });
      }

      if (Array.isArray(liveContext?.files) && liveContext.files.length > 50) {
        return res.status(400).json({ error: "liveContext.files exceeds 50 items" });
      }

      if (Array.isArray(liveContext?.analyticsRows) && liveContext.analyticsRows.length > 50) {
        return res.status(400).json({ error: "liveContext.analyticsRows exceeds 50 items" });
      }

      if (Array.isArray(liveContext?.searchConsoleRows) && liveContext.searchConsoleRows.length > 50) {
        return res.status(400).json({ error: "liveContext.searchConsoleRows exceeds 50 items" });
      }

      if (!aiClient) {
        return res.status(500).json({ text: "Error: No Gemini API Key provided. Please add it to your environment variables." });
      }

      const dataAccessSection = buildDataAccessSection(connectedServices);
      const liveDataSection = buildLiveDataSection(liveContext);

      const response = await aiClient.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{
              text: `You are an AI agent with the role of ${role}. 
          Your current context and mission: ${context}.
          The current date and time is: ${new Date().toISOString()}
          
          ${dataAccessSection}
          ${liveDataSection}
          
          CAPABILITY: You can schedule recurring tasks for yourself or others. 
          To schedule a task, include a JSON block in your response like this:
          \`\`\`json
          {
            "title": "Task Title",
            "description": "Detailed description",
            "assigneeId": "agent-id",
            "dueDate": "ISO-8601 string (e.g. 2026-03-02T15:00:00Z)",
            "repeat": "Recurrence (optional)"
          }
          \`\`\`
          CRITICAL: dueDate MUST be strictly formatted as an ISO-8601 string. Do NOT use natural language like "Tomorrow" or "Later".
          
          CAPABILITY: You can create draft emails in the user's connected Gmail account.
          If the user asks you to write, draft, or prepare an email, DO NOT just write it in the chat. Instead, include a JSON block in your response like this:
          \`\`\`json
          {
            "draftEmail": {
              "to": "email@address.com",
              "subject": "Email Subject",
              "body": "The full text of the email..."
            }
          }
          \`\`\`
          ${canGenerateImage ? `
          CAPABILITY: You can generate images. If you want to generate an image to accompany your response, include a JSON block like this:
          \`\`\`json
          {
            "imagePrompt": "A detailed description of the image to generate"
          }
          \`\`\`
          ` : ""}
          Available agent IDs: executive-assistant, social-media-manager, blog-writer, sales-associate, legal-associate, receptionist.
          
          Respond to the following message as this agent: ${message}`,
            }],
          },
        ],
        config: {
          temperature: 0.7,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      });

      const text = response.text || "I'm sorry, I couldn't process that request.";
      let imageUrl: string | undefined;

      if (canGenerateImage) {
        const imageMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
        if (imageMatch) {
          try {
            const data = JSON.parse(imageMatch[1] || imageMatch[0]);
            if (data.imagePrompt) {
              const imageResponse = await aiClient.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: [{ parts: [{ text: data.imagePrompt }] }],
              });

              for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                  imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                  break;
                }
              }
            }
          } catch {
            // Ignore malformed JSON image blocks from the model.
          }
        }
      }

      return res.json({ text, imageUrl });
    } catch (error) {
      console.error("AI response route error:", error);
      return res.status(500).json({ text: "Error: Failed to connect to my neural network." });
    }
  });

  app.post("/api/workspaces/:id/ai/orchestrate", requireAuth, requireWorkspaceAccess, aiRateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const { taskDescription, agents } = req.body as {
        taskDescription?: string;
        agents?: string[];
      };

      if (!isNonEmptyString(taskDescription)) {
        return res.status(400).json({ error: "taskDescription is required" });
      }

      if (taskDescription.length > 2000) {
        return res.status(400).json({ error: "taskDescription exceeds 2000 characters" });
      }

      if (!Array.isArray(agents) || agents.length === 0 || agents.some((agent) => !isNonEmptyString(agent))) {
        return res.status(400).json({ error: "agents must be a non-empty array of strings" });
      }

      if (agents.length > 10) {
        return res.status(400).json({ error: "agents exceeds maximum of 10" });
      }

      if (agents.some((agent) => agent.length > 100)) {
        return res.status(400).json({ error: "agent id exceeds 100 characters" });
      }

      if (!aiClient) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      }

      const response = await aiClient.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            role: "user",
            parts: [{
              text: `You are the Orchestrator AI. Break down the task into sub-tasks for these agents: ${agents.join(", ")}.
Task: ${taskDescription}

Return strict JSON in this shape:
{
  "plan": [
    { "agentId": "agent-id", "action": "what they should do", "priority": "high|medium|low" }
  ]
}`,
            }],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      const parsed = JSON.parse(response.text || '{"plan": []}');
      return res.json(parsed);
    } catch (error) {
      console.error("AI orchestration route error:", error);
      return res.status(500).json({ error: "Failed to orchestrate task" });
    }
  });
}
