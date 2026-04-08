import { AgentRole } from "../types";
import { apiFetch } from "./apiClient";

export interface LiveContext {
  emails?: Array<{ from: string; subject: string; date: string; snippet: string }>;
  events?: Array<{ summary: string; start: string; end: string; location?: string; attendees?: string[] }>;
  files?: Array<{ name: string; type: string; modifiedTime: string; webViewLink: string }>;
  analyticsRows?: Array<{ date: string; sessions: number; users: number; pageViews: number }>;
  searchConsoleRows?: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
}

export interface ConnectedServices {
  gmail?: boolean;
  calendar?: boolean;
  drive?: boolean;
  slack?: boolean;
  teams?: boolean;
  notion?: boolean;
  linkedin?: boolean;
  buffer?: boolean;
  twilio?: boolean;
  wordpress?: boolean;
  hubspot?: boolean;
  analytics?: boolean;
  searchConsole?: boolean;
}

export async function getAgentResponse(
  message: string,
  threadId: string,
  liveContext?: LiveContext,
  connectedServices?: ConnectedServices,
  token?: string | null,
  activeWorkspaceId?: number | null,
  onAuthFailure?: () => void,
) {
  if (!token || !activeWorkspaceId) {
    return { text: "Error: Missing authenticated workspace context." };
  }

  try {
    const data = await apiFetch<{ response?: string; sender?: string }>(`/api/workspaces/${activeWorkspaceId}/chat`, {
      method: 'POST',
      token,
      onAuthFailure: () => onAuthFailure?.(),
      timeoutMs: 45000,
      body: JSON.stringify({
        threadId,
        message,
        liveContext,
        connectedServices,
      }),
    });

    return { text: data?.response || "Task executed.", sender: data?.sender };
  } catch (error) {
    console.error("Agent response proxy error:", error);
    return { text: "Error: Failed to connect to my neural network." };
  }
}

export async function orchestrateTask(
  taskDescription: string,
  agents: string[],
  token?: string | null,
  activeWorkspaceId?: number | null,
  onAuthFailure?: () => void,
) {
  if (!token || !activeWorkspaceId) {
    return { plan: [] };
  }

  try {
    const data = await apiFetch<{ plan?: Array<{ agentId: string; action: string; priority: 'high' | 'medium' | 'low' }> }>(
      `/api/workspaces/${activeWorkspaceId}/ai/orchestrate`,
      {
        method: 'POST',
        token,
        onAuthFailure: () => onAuthFailure?.(),
        body: JSON.stringify({ taskDescription, agents }),
      },
    );
    return { plan: data.plan || [] };
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
