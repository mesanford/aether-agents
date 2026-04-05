import type { GoogleGenAI } from "@google/genai";
import type { LiveContext, ConnectedServices } from "./types.ts";

export type TaskExecutionType = "generic" | "research" | "draft" | "outreach" | "review";
export type TaskArtifact = {
  type: "brief" | "plan" | "review" | "notes";
  title: string;
  body: string;
  bullets: string[];
  imageUrl?: string;
};

type InferTaskExecutionTypeArgs = {
  taskTitle: string;
  taskDescription?: string | null;
  agentRole?: string | null;
};

type BuildTaskExecutionResultArgs = {
  taskTitle: string;
  taskDescription?: string | null;
  agentName: string;
  agentRole?: string | null;
  executionType?: string | null;
};

function normalize(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function sanitizeDetectedUrl(rawUrl: string) {
  return rawUrl.replace(/[),.;!?]+$/, "").trim();
}

function isSupportedArtifactImageUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
  } catch {
    return false;
  }
}

function extractArtifactImageUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;

    const dataImageMatch = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    if (dataImageMatch?.[0] && isSupportedArtifactImageUrl(dataImageMatch[0])) {
      return dataImageMatch[0];
    }

    const urlMatches = value.match(/https?:\/\/\S+/gi) || [];
    for (const match of urlMatches) {
      const sanitized = sanitizeDetectedUrl(match);
      if (isSupportedArtifactImageUrl(sanitized)) {
        return sanitized;
      }
    }
  }

  return undefined;
}

export function inferTaskExecutionType({
  taskTitle,
  taskDescription,
  agentRole,
}: InferTaskExecutionTypeArgs): TaskExecutionType {
  const title = normalize(taskTitle);
  const description = normalize(taskDescription);
  const role = normalize(agentRole);
  const haystack = `${title} ${description}`;

  if (/(draft|write|outline|compose|prepare copy|reply|blog post|article|content)/.test(haystack)) {
    return "draft";
  }

  if (/(outreach|lead|prospect|follow[- ]?up|sales|contact|pipeline|campaign)/.test(haystack)) {
    return "outreach";
  }

  if (/(review|compliance|contract|legal|triage|categorize|inbox|schedule|audit|intake)/.test(haystack)) {
    return "review";
  }

  if (/(research|analy[sz]e|analysis|ideation|investigate|find|monitor|trend)/.test(haystack)) {
    return "research";
  }

  if (role.includes("blog writer")) return "draft";
  if (role.includes("sales associate")) return "outreach";
  if (role.includes("legal associate")) return "review";
  if (role.includes("executive assistant")) return "review";
  if (role.includes("social media manager")) return "research";
  if (role.includes("receptionist")) return "review";

  return "generic";
}

export function buildTaskExecutionResult({
  taskTitle,
  taskDescription,
  agentName,
  agentRole,
  executionType,
}: BuildTaskExecutionResultArgs) {
  const artifactImageUrl = extractArtifactImageUrl(taskDescription, taskTitle);
  const effectiveExecutionType = (executionType as TaskExecutionType | null) || inferTaskExecutionType({
    taskTitle,
    taskDescription,
    agentRole,
  });

  switch (normalize(agentRole)) {
    case "executive assistant":
      return {
        executionType: effectiveExecutionType === "generic" ? "review" : effectiveExecutionType,
        outputSummary: effectiveExecutionType === "draft"
          ? `Prepared a draft response and action brief for "${taskTitle}".`
          : `Completed inbox and schedule coordination for "${taskTitle}".`,
        messageContent: effectiveExecutionType === "draft"
          ? `I completed **${taskTitle}** and prepared a draft-ready response with the next actions called out.`
          : `I completed **${taskTitle}** and organized the key inbox and scheduling follow-ups.`,
        artifact: {
          type: "brief",
          title: `Executive brief: ${taskTitle}`,
          body: effectiveExecutionType === "draft"
            ? "Draft-ready communication notes and follow-up actions are prepared for review."
            : "Inbox and scheduling work has been triaged into a concise decision brief.",
          bullets: [
            "Captured the highest-priority follow-up items.",
            "Organized the task into a clear next-step sequence.",
            "Prepared an execution-ready handoff summary.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    case "social media manager":
      return {
        executionType: effectiveExecutionType === "generic" ? "research" : effectiveExecutionType,
        outputSummary: `Compiled social execution notes and next recommendations for "${taskTitle}".`,
        messageContent: `I completed **${taskTitle}** and summarized the next social actions, opportunities, and follow-ups.`,
        artifact: {
          type: "notes",
          title: `Social notes: ${taskTitle}`,
          body: "The task has been translated into channel-ready recommendations and near-term follow-ups.",
          bullets: [
            "Summarized the strongest next content or engagement actions.",
            "Captured immediate follow-up opportunities.",
            "Prepared a concise execution note for the next cycle.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    case "blog writer":
      return {
        executionType: effectiveExecutionType === "generic" ? "draft" : effectiveExecutionType,
        outputSummary: `Prepared a content draft brief for "${taskTitle}".`,
        messageContent: `I completed **${taskTitle}** and turned it into a writing-ready brief with structure and angles to develop next.`,
        artifact: {
          type: "brief",
          title: `Draft brief: ${taskTitle}`,
          body: "The task now has a writing-ready structure with a clear angle, scope, and next drafting path.",
          bullets: [
            "Identified the primary narrative angle.",
            "Outlined the key sections to draft next.",
            "Captured the core supporting points to develop.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    case "sales associate":
      return {
        executionType: effectiveExecutionType === "generic" ? "outreach" : effectiveExecutionType,
        outputSummary: `Prepared an outreach plan and follow-up summary for "${taskTitle}".`,
        messageContent: `I completed **${taskTitle}** and produced the outreach priorities, lead notes, and next follow-ups.`,
        artifact: {
          type: "plan",
          title: `Outreach plan: ${taskTitle}`,
          body: "The work has been organized into an outreach-ready sequence with lead handling guidance.",
          bullets: [
            "Prioritized the immediate outreach targets.",
            "Captured the recommended follow-up order.",
            "Summarized the next conversion-oriented actions.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    case "legal associate":
      return {
        executionType: effectiveExecutionType === "generic" ? "review" : effectiveExecutionType,
        outputSummary: `Completed a compliance and risk review for "${taskTitle}".`,
        messageContent: `I completed **${taskTitle}** and logged the key compliance considerations and review notes.`,
        artifact: {
          type: "review",
          title: `Review notes: ${taskTitle}`,
          body: "The task has been converted into a review summary focused on risk, compliance, and follow-up checks.",
          bullets: [
            "Logged the highest-priority review considerations.",
            "Captured the main compliance or contract checkpoints.",
            "Prepared the follow-up issues requiring attention.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    case "receptionist":
      return {
        executionType: effectiveExecutionType === "generic" ? "review" : effectiveExecutionType,
        outputSummary: `Organized inbound requests and follow-up notes for "${taskTitle}".`,
        messageContent: `I completed **${taskTitle}** and summarized the intake queue with the needed follow-up actions.`,
        artifact: {
          type: "notes",
          title: `Intake notes: ${taskTitle}`,
          body: "The inbound work has been condensed into an intake summary with next routing actions.",
          bullets: [
            "Summarized the top inbound requests.",
            "Captured the routing and follow-up priorities.",
            "Prepared a quick-reference intake handoff.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
    default:
      return {
        executionType: effectiveExecutionType,
        outputSummary: `Completed by ${agentName} via execution engine.`,
        messageContent: `I have completed the scheduled task: **${taskTitle}**. Completed by ${agentName} via execution engine.`,
        artifact: {
          type: "notes",
          title: `Execution notes: ${taskTitle}`,
          body: `This task was completed by ${agentName} and recorded by the execution engine.`,
          bullets: [
            "Execution completed successfully.",
            "A summary was recorded for the task.",
            "The task is ready for follow-up or review.",
          ],
          ...(artifactImageUrl ? { imageUrl: artifactImageUrl } : {}),
        } satisfies TaskArtifact,
      };
  }
}

const ARTIFACT_TYPES = new Set(["brief", "plan", "review", "notes"]);

type BuildAiTaskExecutionResultArgs = BuildTaskExecutionResultArgs & {
  aiClient: GoogleGenAI;
  agentDescription?: string | null;
  agentCapabilities?: string | null;
  liveContext?: LiveContext;
  connectedServices?: ConnectedServices;
};

/**
 * Calls Gemini to generate a real, task-specific artifact instead of the
 * static template strings in buildTaskExecutionResult. Falls back to
 * buildTaskExecutionResult if the AI call fails or returns an unexpected shape.
 */
export async function buildAiTaskExecutionResult({
  taskTitle,
  taskDescription,
  agentName,
  agentRole,
  executionType,
  aiClient,
  agentDescription,
  agentCapabilities,
  liveContext,
  connectedServices,
}: BuildAiTaskExecutionResultArgs) {
  const fallbackArtifactImageUrl = extractArtifactImageUrl(taskDescription, taskTitle);
  const effectiveExecutionType =
    (executionType as TaskExecutionType | null) ||
    inferTaskExecutionType({ taskTitle, taskDescription, agentRole });

  const capsList = (() => {
    try {
      const parsed = JSON.parse(agentCapabilities || "[]");
      if (Array.isArray(parsed)) return parsed.join(", ");
    } catch {
      /* ignore */
    }
    return agentCapabilities || "";
  })();

  const liveDataLines: string[] = [];
  if (liveContext?.emails?.length) {
    liveDataLines.push(
      `LIVE GMAIL DATA (${new Date().toLocaleDateString()} — use as ground truth):`,
      ...liveContext.emails.map(
        (e) => `- From: ${e.from}  Subject: ${e.subject}  Date: ${e.date}  Preview: ${e.snippet}`,
      ),
    );
  }
  if (liveContext?.events?.length) {
    liveDataLines.push(
      `LIVE CALENDAR DATA (upcoming events):`,
      ...liveContext.events.map(
        (e) =>
          `- ${e.summary} — ${new Date(e.start).toLocaleString()} to ${new Date(e.end).toLocaleTimeString()}` +
          (e.location ? ` @ ${e.location}` : "") +
          (e.attendees?.length ? ` (with: ${e.attendees.join(", ")})` : ""),
      ),
    );
  }
  if (liveContext?.files?.length) {
    liveDataLines.push(
      `LIVE DRIVE DATA (recently modified files):`,
      ...liveContext.files
        .slice(0, 10)
        .map((f) => `- [${f.type.toUpperCase()}] ${f.name} — modified ${new Date(f.modifiedTime).toLocaleDateString()}`),
    );
  }

  const liveDataSection =
    liveDataLines.length > 0
      ? [
          "",
          "--- LIVE CONNECTED DATA (real, accurate — incorporate into your artifact output) ---",
          ...liveDataLines,
          "--- END LIVE DATA ---",
        ].join("\n")
      : "";

  const dataAccessNote =
    connectedServices?.gmail || connectedServices?.calendar || connectedServices?.drive
      ? `CONNECTED SERVICES: You have live access to ${[
          connectedServices.gmail ? "Gmail" : "",
          connectedServices.calendar ? "Google Calendar" : "",
          connectedServices.drive ? "Google Drive" : "",
        ]
          .filter(Boolean)
          .join(", ")}. Use the LIVE CONNECTED DATA section above to produce specific, grounded output. Do NOT fabricate email names, event titles, or file names.`
      : "";

  const prompt = [
    `You are ${agentName}, an AI agent with the role of ${agentRole || "agent"}.`,
    agentDescription ? `Your background: ${agentDescription}` : "",
    capsList ? `Your capabilities: ${capsList}` : "",
    `Today is ${new Date().toISOString()}.`,
    dataAccessNote,
    liveDataSection,
    "",
    `You have just completed the following scheduled task:`,
    `Title: ${taskTitle}`,
    taskDescription ? `Description: ${taskDescription}` : "",
    "",
    `Produce a work artifact that captures the real, specific output of this task.`,
    `The artifact will be shown to your team and may be promoted to lead notes or drafted into an email.`,
    "",
    `Return ONLY valid JSON matching this exact shape:`,
    `{`,
    `  "artifactType": "brief|plan|review|notes",`,
    `  "artifactTitle": "...",`,
    `  "artifactBody": "...",`,
    `  "artifactBullets": ["...", "...", "..."],`,
    `  "artifactImageUrl": "... or null",`,
    `  "messageContent": "...",`,
    `  "outputSummary": "..."`,
    `}`,
    "",
    `Rules:`,
    `- artifactType: pick the best fit — "brief" (executive/writing output), "plan" (outreach/action plan), "review" (compliance/analysis), "notes" (research/intake)`,
    `- artifactTitle: concise label for this artifact (max 80 characters)`,
    `- artifactBody: 1-2 sentences describing the completed work (max 300 characters)`,
    `- artifactBullets: exactly 3 concrete, specific bullet points about this task's real output`,
    `- artifactImageUrl: include ONLY a real image URL or data URL already present in the task context if this artifact should carry media; otherwise return null`,
    `- messageContent: 1 sentence the agent posts in team chat confirming completion — use Markdown bold for the task title, e.g. **${taskTitle}**`,
    `- outputSummary: 1 short sentence for the task list summary line`,
    "",
    `Be specific to the task title and description. Do NOT produce generic placeholder text.`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await aiClient.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  const parsed = JSON.parse(response.text || "{}");

  if (
    typeof parsed.artifactTitle !== "string" ||
    typeof parsed.artifactBody !== "string" ||
    !Array.isArray(parsed.artifactBullets) ||
    parsed.artifactBullets.length < 1
  ) {
    throw new Error("Invalid AI artifact response shape");
  }

  const rawType = typeof parsed.artifactType === "string" ? parsed.artifactType : "";
  const artifactType = ARTIFACT_TYPES.has(rawType)
    ? (rawType as TaskArtifact["type"])
    : "notes";
  const parsedArtifactImageUrl = isSupportedArtifactImageUrl(parsed.artifactImageUrl)
    ? parsed.artifactImageUrl.trim()
    : fallbackArtifactImageUrl;

  return {
    executionType: effectiveExecutionType,
    outputSummary:
      typeof parsed.outputSummary === "string" && parsed.outputSummary.trim()
        ? parsed.outputSummary.trim()
        : `Completed by ${agentName}.`,
    messageContent:
      typeof parsed.messageContent === "string" && parsed.messageContent.trim()
        ? parsed.messageContent.trim()
        : `I completed **${taskTitle}**.`,
    artifact: {
      type: artifactType,
      title: parsed.artifactTitle.slice(0, 120),
      body: parsed.artifactBody.slice(0, 500),
      bullets: (parsed.artifactBullets as unknown[])
        .filter((b) => typeof b === "string")
        .slice(0, 5)
        .map((b) => (b as string).slice(0, 200)),
      ...(parsedArtifactImageUrl ? { imageUrl: parsedArtifactImageUrl } : {}),
    } satisfies TaskArtifact,
  };
}