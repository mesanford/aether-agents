import { GoogleGenAI } from "@google/genai";
import { AgentRole } from "../types";

let ai: GoogleGenAI | null = null;

try {
  // Only initialize if we have a key so that the frontend doesn't crash on boot missing it
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.warn("Failed to initialize Gemini API client:", e);
}

export interface LiveContext {
  emails?: Array<{ from: string; subject: string; date: string; snippet: string }>;
  events?: Array<{ summary: string; start: string; end: string; location?: string; attendees?: string[] }>;
  files?: Array<{ name: string; type: string; modifiedTime: string; webViewLink: string }>;
}

export interface ConnectedServices {
  gmail?: boolean;
  calendar?: boolean;
  drive?: boolean;
}

export async function getAgentResponse(
  role: AgentRole,
  message: string,
  context: string = "",
  canGenerateImage: boolean = false,
  liveContext?: LiveContext,
  connectedServices?: ConnectedServices
) {
  if (!ai) {
    return { text: "Error: No Gemini API Key provided. Please add it to your environment variables." };
  }

  // Build live data context string to inject into the prompt
  let liveDataSection = "";
  if (liveContext) {
    const parts: string[] = [];
    if (liveContext.emails?.length) {
      parts.push(`LIVE GMAIL DATA (${new Date().toLocaleDateString()} — use this as ground truth):\n` +
        liveContext.emails.map(e =>
          `• From: ${e.from}\n  Subject: ${e.subject}\n  Date: ${e.date}\n  Preview: ${e.snippet}`
        ).join("\n"));
    }
    if (liveContext.events?.length) {
      parts.push(`LIVE CALENDAR DATA (${new Date().toLocaleDateString()} — use this as ground truth):\n` +
        liveContext.events.map(e =>
          `• ${e.summary} — ${new Date(e.start).toLocaleString()} to ${new Date(e.end).toLocaleTimeString()}${e.location ? ` @ ${e.location}` : ""}${e.attendees?.length ? ` (with: ${e.attendees.join(", ")})` : ""}`
        ).join("\n"));
    }
    if (liveContext.files?.length) {
      parts.push(`LIVE DRIVE DATA (recently modified files):\n` +
        liveContext.files.slice(0, 10).map(f =>
          `• [${f.type.toUpperCase()}] ${f.name} — modified ${new Date(f.modifiedTime).toLocaleDateString()}`
        ).join("\n"));
    }
    if (parts.length > 0) {
      liveDataSection = `\n\n--- LIVE CONNECTED DATA (real, accurate — use this to answer the user's question) ---\n${parts.join("\n\n")}\n--- END LIVE DATA ---`;
    }
  }

  // Build the data-access section dynamically based on what is actually connected
  const hasGmail = connectedServices?.gmail;
  const hasCalendar = connectedServices?.calendar;
  const hasDrive = connectedServices?.drive;
  const hasAnyService = hasGmail || hasCalendar || hasDrive;

  let dataAccessSection: string;
  if (hasAnyService) {
    const serviceList = [
      hasGmail ? 'Gmail (inbox, emails)' : null,
      hasCalendar ? 'Google Calendar (events, schedule)' : null,
      hasDrive ? 'Google Drive, Docs, and Slides (files)' : null,
    ].filter(Boolean).join(', ');

    dataAccessSection = `CONNECTED SERVICES: You have live access to the following services for this user: ${serviceList}.
          - When the user asks about emails, inbox, schedule, calendar, documents, or files, real data will be injected into this prompt under the LIVE CONNECTED DATA section below.
          - If that section contains data, use it to answer accurately and specifically. Do NOT say you lack access.
          - If the LIVE CONNECTED DATA section is absent or empty for a particular service, it means there is no data available right now (e.g. no emails in inbox, no upcoming events) — report that clearly.
          - CRITICAL: Do NOT invent, guess, or fabricate any email subjects, sender names, event titles, or file names. Your description/mission context is NOT a source of real data — only the LIVE CONNECTED DATA section is real. If you mention something not present in LIVE CONNECTED DATA, you are hallucinating.
          - Never present fabricated data as real.`;
  } else {
    dataAccessSection = `DATA ACCESS: You do NOT have live access to any external systems (Gmail, Google Calendar, Drive, Slack, etc.).
          - If asked about real-time data, do NOT make it up. Tell the user you don't have access and suggest connecting via Settings → Integrations.
          - Never present fabricated data as real.`;
  }

  try {
    const response = await ai.models.generateContent({
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
          CRITICAL: dueDate MUST be strictly formatted as an ISO-8601 string. Do NOT use natural language like "Tomorrow" or "Later". Calculate the future ISO date based on the current date and time provided above.
          
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
          When you do this, I will automatically send it to Gmail. You should still say something like "I have prepared a draft reply for you" in your natural language response.
          ${canGenerateImage ? `
          CAPABILITY: You can generate images. If you want to generate an image to accompany your response, include a JSON block like this:
          \`\`\`json
          {
            "imagePrompt": "A detailed description of the image to generate"
          }
          \`\`\`
          ` : ''}
          Available agent IDs: executive-assistant, social-media-manager, blog-writer, sales-associate, legal-associate, receptionist.
          
          Respond to the following message as this agent: ${message}`
          }]
        }
      ],
      config: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 4096,
      }
    });

    const text = response.text || "I'm sorry, I couldn't process that request.";
    let imageUrl: string | undefined = undefined;

    if (canGenerateImage) {
      const imageMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
      if (imageMatch) {
        try {
          const data = JSON.parse(imageMatch[1] || imageMatch[0]);
          if (data.imagePrompt) {
            const imageResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: [{ parts: [{ text: data.imagePrompt }] }],
            });

            for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                break;
              }
            }
          }
        } catch (e) {
          // Not a valid image prompt JSON or failed to generate
        }
      }
    }

    return { text, imageUrl };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { text: "Error: Failed to connect to my neural network." };
  }
}

export async function orchestrateTask(taskDescription: string, agents: string[]) {
  if (!ai) {
    console.error("Orchestration Error: No Gemini API Key provided.");
    return { plan: [] };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [{
            text: `You are the Orchestrator AI. Your job is to break down the following task into sub-tasks for these specialized agents: ${agents.join(", ")}.
          Task: ${taskDescription}
          
          Provide a JSON response with the following structure:
          {
            "plan": [
              { "agentId": "agent-id", "action": "what they should do", "priority": "high|medium|low" }
            ]
          }` }]
        }
      ],
      config: {
        responseMimeType: "application/json",
      }
    });

    return JSON.parse(response.text || '{"plan": []}');
  } catch (error) {
    console.error("Orchestration Error:", error);
    return { plan: [] };
  }
}

export function parseTaskFromResponse(text: string) {
  // Simple regex to find a JSON block that looks like a task
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (data.title && data.assigneeId) {
        return {
          title: data.title,
          description: data.description || "",
          assigneeId: data.assigneeId,
          dueDate: data.dueDate || "Tomorrow",
          repeat: data.repeat
        };
      }
    } catch (e) {
      // Not a valid task JSON
    }
  }
  return null;
}

export function parseDraftEmailFromResponse(text: string) {
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      if (data.draftEmail && data.draftEmail.to && data.draftEmail.subject && data.draftEmail.body) {
        return data.draftEmail;
      }
    } catch (e) {
      // Not a valid draft JSON
    }
  }
  return null;
}

/**
 * Strip all ```json ... ``` blocks from agent response text before displaying in chat.
 * This prevents raw task/image JSON from showing up as part of the message bubble.
 */
export function stripAgentJson(text: string): string {
  return text
    // Remove fenced ```json blocks (task scheduling, image prompts, etc.)
    .replace(/```json\n[\s\S]*?\n```/g, '')
    // Remove any bare { ... } JSON objects that remain on their own lines
    .replace(/^\s*\{[\s\S]*?\}\s*$/gm, '')
    // Collapse 3+ consecutive blank lines down to 1
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
