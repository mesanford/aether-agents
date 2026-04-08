import type Database from "better-sqlite3";
import type { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import {
  buildAiTaskExecutionResult,
  buildTaskExecutionResult,
  inferTaskExecutionType,
} from "./taskExecution.ts";
import { fetchWorkspaceLiveContext } from "./workspaceLiveContext.ts";
import {
  createBufferUpdate,
  createLinkedInPost,
  extractFirstNonImageUrl,
  fetchBufferProfiles,
  isImageUrl,
} from "./socialPublishing.ts";
import { checkAndIncrementDailyAIRequestLimit, DailyLimitExceededError } from "./ai/rateLimiterUtility.ts";

type TaskEngineOptions = {
  db: Database.Database;
  pollIntervalMs?: number;
  aiClient?: GoogleGenAI | null;
  googleClientId?: string;
  googleClientSecret?: string;
};

type ExecutePendingTasksOptions = {
  db: Database.Database;
  now?: string;
  createMessageId?: (workspaceId: number) => string;
  aiClient?: GoogleGenAI | null;
  googleClientId?: string;
  googleClientSecret?: string;
};

type TaskArtifact = {
  type: string;
  title: string;
  body: string;
  bullets: string[];
  imageUrl?: string;
};

type AutomationSettings = {
  linkedin_mode: string;
  buffer_mode: string;
  teams_mode: string;
  notion_mode: string;
  buffer_profile_id: string | null;
  notion_parent_page_id: string | null;
  require_artifact_image: number;
  approval_mode_linkedin: string;
  approval_mode_buffer: string;
  approval_mode_instagram: string;
  approval_mode_twitter: string;
  approval_mode_facebook: string;
};

type AutomationJob = {
  id: number;
  workspace_id: number;
  source: string;
  channel: string | null;
  action: string;
  payload: string | null;
  attempts: number;
  max_attempts: number;
};

type TeamsConnection = {
  webhook_url: string;
  default_channel_name: string | null;
};

type NotionConnection = {
  integration_token: string;
  default_parent_page_id: string | null;
};

function writeAutomationAuditLog(
  db: Database.Database,
  workspaceId: number,
  action: string,
  details: Record<string, unknown>,
) {
  try {
    db.prepare(
      "INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES (?, ?, ?, ?, ?)",
    ).run(workspaceId, null, action, "tasks", JSON.stringify(details));
  } catch {
    // Audit logging is best-effort and should not block task execution.
  }
}

function defaultCreateMessageId(workspaceId: number) {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}:${workspaceId}`;
}

function getRetryDelaySeconds(attempt: number) {
  const boundedAttempt = Math.max(1, Math.min(6, attempt));
  return 30 * (2 ** (boundedAttempt - 1));
}

function buildTaskChannelText(task: { title: string; output_summary?: string | null }, artifact: TaskArtifact) {
  const lines = [
    `Task Completed: ${task.title}`,
    "",
    artifact.title,
    artifact.body,
    ...artifact.bullets.map((bullet) => `- ${bullet}`),
  ].filter(Boolean);

  if (task.output_summary) {
    lines.push("", `Summary: ${task.output_summary}`);
  }

  const text = lines.join("\n").trim();
  return text.length > 3200 ? `${text.slice(0, 3197)}...` : text;
}

async function sendTeamsWebhookMessage(webhookUrl: string, text: string, title: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      summary: title,
      themeColor: "0078D4",
      title,
      text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Teams message failed with status ${response.status}`);
  }
}

async function createNotionPageFromAutomation(
  integrationToken: string,
  parentPageId: string,
  title: string,
  content: string,
) {
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{
            type: "text",
            text: { content: title },
          }],
        },
      },
      children: [{
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{
            type: "text",
            text: { content },
          }],
        },
      }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Notion page creation failed with status ${response.status}`);
  }
}

export function enqueueAutomationJob(
  db: Database.Database,
  params: {
    workspaceId: number;
    source: string;
    action: string;
    channel?: string | null;
    payload?: Record<string, unknown> | null;
    dedupeKey?: string | null;
    maxAttempts?: number;
  },
) {
  const {
    workspaceId,
    source,
    action,
    channel = null,
    payload = null,
    dedupeKey = null,
    maxAttempts = 5,
  } = params;

  const result = db.prepare(`
    INSERT OR IGNORE INTO automation_jobs (workspace_id, source, channel, action, status, payload, dedupe_key, attempts, max_attempts, next_run_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    workspaceId,
    source,
    channel,
    action,
    payload ? JSON.stringify(payload) : null,
    dedupeKey,
    maxAttempts,
  );

  return {
    queued: Number((result as { changes?: number }).changes || 0) > 0,
  };
}

function buildChannelAutomationDedupeKey(
  channel: "teams" | "notion",
  taskId: string,
  artifact: TaskArtifact,
  outputSummary?: string | null,
) {
  const signature = JSON.stringify({
    channel,
    taskId,
    title: artifact.title,
    body: artifact.body,
    bullets: artifact.bullets,
    imageUrl: artifact.imageUrl || null,
    outputSummary: outputSummary || null,
  });

  return createHash("sha256").update(signature).digest("hex");
}

export async function processAutomationJobs(db: Database.Database, limit = 10) {
  const jobs = db.prepare(`
    SELECT id, workspace_id, source, channel, action, payload, attempts, max_attempts
    FROM automation_jobs
    WHERE status IN ('queued', 'retrying')
      AND datetime(next_run_at) <= datetime('now')
    ORDER BY id ASC
    LIMIT ?
  `).all(limit) as AutomationJob[];

  for (const job of jobs) {
    db.prepare("UPDATE automation_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'retrying')")
      .run(job.id);

    try {
      let payload: Record<string, unknown> | null = null;
      if (job.payload) {
        payload = JSON.parse(job.payload) as Record<string, unknown>;
      }

      if (job.action === "task.automation.retry") {
        const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
        if (!taskId) {
          throw new Error("taskId is required for task.automation.retry");
        }
        await dispatchTaskAutomationForTaskId(db, job.workspace_id, taskId);
      } else if (job.action === "teams.message.send") {
        const teams = db
          .prepare("SELECT webhook_url, default_channel_name FROM teams_connections WHERE workspace_id = ?")
          .get(job.workspace_id) as TeamsConnection | undefined;
        if (!teams?.webhook_url) {
          throw new Error("Teams connection not found");
        }

        const text = typeof payload?.text === "string" ? payload.text : null;
        const title = typeof payload?.title === "string" ? payload.title : "Task update";
        if (!text || !text.trim()) {
          throw new Error("text is required for teams.message.send");
        }

        await sendTeamsWebhookMessage(teams.webhook_url, text.trim(), title.trim());
      } else if (job.action === "notion.page.create") {
        const notion = db
          .prepare("SELECT integration_token, default_parent_page_id FROM notion_connections WHERE workspace_id = ?")
          .get(job.workspace_id) as NotionConnection | undefined;
        if (!notion?.integration_token) {
          throw new Error("Notion connection not found");
        }

        const title = typeof payload?.title === "string" ? payload.title : null;
        const content = typeof payload?.content === "string" ? payload.content : null;
        const parentPageId = typeof payload?.parentPageId === "string" && payload.parentPageId.trim()
          ? payload.parentPageId.trim()
          : notion.default_parent_page_id;

        if (!title || !title.trim()) {
          throw new Error("title is required for notion.page.create");
        }
        if (!content || !content.trim()) {
          throw new Error("content is required for notion.page.create");
        }
        if (!parentPageId) {
          throw new Error("parentPageId is required for notion.page.create");
        }

        await createNotionPageFromAutomation(
          notion.integration_token,
          parentPageId,
          title.trim(),
          content.trim(),
        );
      } else if (job.action === "webhook.event.ingested") {
        // Webhooks are currently logged and acknowledged; future handlers can fan out here.
      } else {
        throw new Error(`Unsupported job action: ${job.action}`);
      }

      db.prepare("UPDATE automation_jobs SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(job.id);

      writeAutomationAuditLog(db, job.workspace_id, "task.automation.job.succeeded", {
        jobId: job.id,
        source: job.source,
        channel: job.channel,
        action: job.action,
        attempts: job.attempts + 1,
      });
    } catch (err: any) {
      const nextAttempts = job.attempts + 1;
      const finalFailure = nextAttempts >= job.max_attempts;
      const delaySeconds = getRetryDelaySeconds(nextAttempts);
      const errorMessage = err?.message || "unknown_error";

      if (finalFailure) {
        db.prepare(`
          UPDATE automation_jobs
          SET status = 'dead_lettered', attempts = ?, last_error = ?, dead_lettered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextAttempts, errorMessage, job.id);

        writeAutomationAuditLog(db, job.workspace_id, "task.automation.job.dead_lettered", {
          jobId: job.id,
          source: job.source,
          channel: job.channel,
          action: job.action,
          attempts: nextAttempts,
          error: errorMessage,
        });
      } else {
        db.prepare(`
          UPDATE automation_jobs
          SET status = 'retrying', attempts = ?, last_error = ?, next_run_at = datetime('now', '+' || ? || ' seconds'), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextAttempts, errorMessage, String(delaySeconds), job.id);

        writeAutomationAuditLog(db, job.workspace_id, "task.automation.job.retrying", {
          jobId: job.id,
          source: job.source,
          channel: job.channel,
          action: job.action,
          attempts: nextAttempts,
          nextDelaySeconds: delaySeconds,
          error: errorMessage,
        });
      }
    }
  }
}

function isLikelySocialTask(task: { title?: string; description?: string; execution_type?: string }, agentRole?: string | null) {
  const roleText = String(agentRole || "").toLowerCase();
  const bodyText = `${task.title || ""} ${task.description || ""}`.toLowerCase();
  return (
    task.execution_type === "social_post"
    || roleText.includes("social")
    || bodyText.includes("social")
    || bodyText.includes("linkedin")
    || bodyText.includes("buffer")
  );
}

function buildSocialPayload(task: { title: string; description?: string; output_summary?: string | null }, artifact: TaskArtifact, imageUrl?: string | null) {
  const textParts = [
    artifact.title,
    artifact.body,
    ...artifact.bullets.map((bullet) => `- ${bullet}`),
  ].filter(Boolean);
  const text = textParts.join("\n\n").trim();
  const link = extractFirstNonImageUrl(task.output_summary || undefined, artifact.body, task.description || undefined);
  const selectedImage = imageUrl && isImageUrl(imageUrl)
    ? imageUrl
    : (artifact.imageUrl && isImageUrl(artifact.imageUrl) ? artifact.imageUrl : null);

  return {
    text: text.length > 2800 ? `${text.slice(0, 2797)}...` : text,
    link,
    imageUrl: selectedImage,
    title: artifact.title,
    description: task.output_summary || artifact.body,
  };
}

function enqueueApprovalRequest(
  db: Database.Database,
  params: {
    workspaceId: number;
    taskId: string | null;
    agentId: string;
    agentName: string | null;
    actionType: string;
    payload: Record<string, unknown>;
  },
) {
  db.prepare(`
    INSERT INTO approval_requests (workspace_id, task_id, agent_id, agent_name, action_type, payload, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    params.workspaceId,
    params.taskId,
    params.agentId,
    params.agentName,
    params.actionType,
    JSON.stringify(params.payload),
  );
}

async function maybeDispatchSocialAutomation(db: Database.Database, task: any, artifact: TaskArtifact) {
  const settings = db
    .prepare(`SELECT linkedin_mode, buffer_mode, buffer_profile_id, require_artifact_image,
              approval_mode_linkedin, approval_mode_buffer, approval_mode_instagram,
              approval_mode_twitter, approval_mode_facebook
              FROM workspace_automation_settings WHERE workspace_id = ?`)
    .get(task.workspace_id) as AutomationSettings | undefined;

  if (!settings || (settings.linkedin_mode !== "publish" && settings.buffer_mode !== "queue")) {
    return;
  }

  const baseDetails = {
    taskId: task.id,
    linkedinMode: settings.linkedin_mode,
    bufferMode: settings.buffer_mode,
    requireArtifactImage: Boolean(settings.require_artifact_image),
    assigneeRole: task.assignee_role || null,
  };
  writeAutomationAuditLog(db, task.workspace_id, "task.automation.attempted", baseDetails);

  if (!isLikelySocialTask(task, task.assignee_role)) {
    writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
      ...baseDetails,
      reason: "not_social_task",
    });
    return;
  }

  const selectedMedia = typeof task.selected_media_asset_id === "number"
    ? db
        .prepare("SELECT thumbnail FROM media_assets WHERE id = ? AND workspace_id = ?")
        .get(task.selected_media_asset_id, task.workspace_id) as { thumbnail?: string } | undefined
    : undefined;

  const payload = buildSocialPayload(task, artifact, selectedMedia?.thumbnail || null);
  if (!payload.text) {
    writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
      ...baseDetails,
      reason: "empty_payload_text",
    });
    return;
  }

  if (settings.require_artifact_image && !payload.imageUrl) {
    writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
      ...baseDetails,
      reason: "image_required_missing",
    });
    return;
  }

  const approvalModeLinkedIn = settings.approval_mode_linkedin || "auto";
  const approvalModeBuffer = settings.approval_mode_buffer || "auto";

  if (settings.linkedin_mode === "publish") {
    const linkedin = db
      .prepare("SELECT access_token, author_urn FROM linkedin_connections WHERE workspace_id = ?")
      .get(task.workspace_id) as { access_token: string; author_urn: string } | undefined;
    if (!linkedin) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
        ...baseDetails,
        channel: "linkedin",
        reason: "connection_missing",
      });
    } else if (approvalModeLinkedIn === "approval") {
      enqueueApprovalRequest(db, {
        workspaceId: task.workspace_id,
        taskId: String(task.id),
        agentId: String(task.assignee_id),
        agentName: task.assignee_name || null,
        actionType: "linkedin_post",
        payload: {
          text: payload.text,
          link: payload.link,
          imageUrl: payload.imageUrl,
          title: payload.title,
          description: payload.description,
        },
      });
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.linkedin.approval_queued", {
        ...baseDetails,
        channel: "linkedin",
      });
    } else {
      try {
        await createLinkedInPost(linkedin.access_token, linkedin.author_urn, payload.text, {
          url: payload.link || undefined,
          imageUrl: payload.imageUrl || undefined,
          title: payload.title,
          description: payload.description,
        });
        writeAutomationAuditLog(db, task.workspace_id, "task.automation.linkedin.succeeded", {
          ...baseDetails,
          channel: "linkedin",
          hasImage: Boolean(payload.imageUrl),
          hasLink: Boolean(payload.link),
        });
      } catch (err: any) {
        writeAutomationAuditLog(db, task.workspace_id, "task.automation.linkedin.failed", {
          ...baseDetails,
          channel: "linkedin",
          error: err?.message || "unknown_error",
        });
      }
    }
  }

  if (settings.buffer_mode === "queue") {
    const buffer = db
      .prepare("SELECT access_token FROM buffer_connections WHERE workspace_id = ?")
      .get(task.workspace_id) as { access_token: string } | undefined;

    if (!buffer) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
        ...baseDetails,
        channel: "buffer",
        reason: "connection_missing",
      });
      return;
    }

    if (approvalModeBuffer === "approval") {
      enqueueApprovalRequest(db, {
        workspaceId: task.workspace_id,
        taskId: String(task.id),
        agentId: String(task.assignee_id),
        agentName: task.assignee_name || null,
        actionType: "buffer_post",
        payload: {
          text: payload.text,
          link: payload.link,
          imageUrl: payload.imageUrl,
          title: payload.title,
          description: payload.description,
          profileId: settings.buffer_profile_id || null,
        },
      });
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.buffer.approval_queued", {
        ...baseDetails,
        channel: "buffer",
      });
      return;
    }

    let profileId = settings.buffer_profile_id || null;
    if (!profileId) {
      try {
        const profiles = await fetchBufferProfiles(buffer.access_token);
        const defaultProfile = profiles.find((profile) => profile.isDefault) || profiles[0];
        profileId = defaultProfile?.id || null;

        if (profileId) {
          writeAutomationAuditLog(db, task.workspace_id, "task.automation.buffer.profile_auto_selected", {
            ...baseDetails,
            channel: "buffer",
            profileId,
            reason: "workspace_profile_not_set",
          });
        }
      } catch (err: any) {
        writeAutomationAuditLog(db, task.workspace_id, "task.automation.buffer.failed", {
          ...baseDetails,
          channel: "buffer",
          error: err?.message || "buffer_profile_lookup_failed",
        });
        return;
      }
    }

    if (!profileId) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.skipped", {
        ...baseDetails,
        channel: "buffer",
        reason: "buffer_profile_missing",
      });
      return;
    }

    try {
      await createBufferUpdate(buffer.access_token, [profileId], payload.text, {
        link: payload.link || undefined,
        imageUrl: payload.imageUrl || undefined,
      });
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.buffer.succeeded", {
        ...baseDetails,
        channel: "buffer",
        profileId,
        hasImage: Boolean(payload.imageUrl),
        hasLink: Boolean(payload.link),
      });
    } catch (err: any) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.buffer.failed", {
        ...baseDetails,
        channel: "buffer",
        profileId,
        error: err?.message || "unknown_error",
      });
    }
  }
}

function maybeEnqueueWorkspaceChannelAutomation(db: Database.Database, task: any, artifact: TaskArtifact) {
  const settings = db
    .prepare("SELECT teams_mode, notion_mode, notion_parent_page_id FROM workspace_automation_settings WHERE workspace_id = ?")
    .get(task.workspace_id) as Pick<AutomationSettings, "teams_mode" | "notion_mode" | "notion_parent_page_id"> | undefined;

  if (!settings) {
    return;
  }

  const channelText = buildTaskChannelText(task, artifact);

  const teams = settings.teams_mode === "send"
    ? db
        .prepare("SELECT default_channel_name FROM teams_connections WHERE workspace_id = ?")
        .get(task.workspace_id) as { default_channel_name: string | null } | undefined
    : undefined;
  if (teams && settings.teams_mode === "send") {
    const dedupeKey = buildChannelAutomationDedupeKey("teams", String(task.id), artifact, task.output_summary || null);
    const queued = enqueueAutomationJob(db, {
      workspaceId: task.workspace_id,
      source: "task-engine",
      action: "teams.message.send",
      channel: "teams",
      dedupeKey,
      payload: {
        taskId: task.id,
        title: artifact.title || task.title,
        text: channelText,
        channelName: teams.default_channel_name,
      },
    });
    if (!queued.queued) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.job.deduped", {
        taskId: task.id,
        channel: "teams",
        action: "teams.message.send",
        dedupeKey,
      });
    }
  }

  const notion = settings.notion_mode === "create"
    ? db
        .prepare("SELECT default_parent_page_id FROM notion_connections WHERE workspace_id = ?")
        .get(task.workspace_id) as { default_parent_page_id: string | null } | undefined
    : undefined;
  if (notion && settings.notion_mode === "create") {
    const dedupeKey = buildChannelAutomationDedupeKey("notion", String(task.id), artifact, task.output_summary || null);
    const queued = enqueueAutomationJob(db, {
      workspaceId: task.workspace_id,
      source: "task-engine",
      action: "notion.page.create",
      channel: "notion",
      dedupeKey,
      payload: {
        taskId: task.id,
        title: artifact.title || task.title,
        content: channelText,
        parentPageId: settings.notion_parent_page_id || notion.default_parent_page_id,
      },
    });
    if (!queued.queued) {
      writeAutomationAuditLog(db, task.workspace_id, "task.automation.job.deduped", {
        taskId: task.id,
        channel: "notion",
        action: "notion.page.create",
        dedupeKey,
      });
    }
  }
}

export async function dispatchTaskAutomationForTaskId(
  db: Database.Database,
  workspaceId: number,
  taskId: string,
) {
  const task = db
    .prepare(`
      SELECT t.*, a.role as assignee_role
      FROM tasks t
      LEFT JOIN agents a ON a.id = t.assignee_id AND a.workspace_id = t.workspace_id
      WHERE t.id = ? AND t.workspace_id = ?
    `)
    .get(taskId, workspaceId) as any;

  if (!task) {
    throw new Error("Task not found");
  }

  if (!task.artifact_payload) {
    throw new Error("Task artifact not found");
  }

  let artifact: TaskArtifact;
  try {
    artifact = JSON.parse(task.artifact_payload) as TaskArtifact;
  } catch {
    throw new Error("Task artifact is invalid");
  }

  if (!artifact || typeof artifact.title !== "string" || typeof artifact.body !== "string" || !Array.isArray(artifact.bullets)) {
    throw new Error("Task artifact is invalid");
  }

  await maybeDispatchSocialAutomation(db, task, artifact);
}

export async function executePendingTasks({
  db,
  now = new Date().toISOString(),
  createMessageId = defaultCreateMessageId,
  aiClient,
  googleClientId,
  googleClientSecret,
}: ExecutePendingTasksOptions) {
  const runTimestamp = Date.now();

  // Query all todo items and filter in Node since some due_date values are natural language.
  const todoTasks = db
    .prepare(`
      SELECT t.*, a.role as assignee_role
      FROM tasks t
      LEFT JOIN agents a ON a.id = t.assignee_id AND a.workspace_id = t.workspace_id
      WHERE t.status = 'todo'
    `)
    .all() as any[];

  for (const task of todoTasks) {
    if (!task.due_date) continue;

    const isIsoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|([+-]\d{2}:\d{2}))?$/.test(task.due_date);
    if (!isIsoDate) continue;

    if (task.due_date <= now) {
      console.log(`[Task Engine] Executing task: ${task.title}`);

      db.prepare("UPDATE tasks SET status = 'running', started_at = ?, last_run_at = ?, completed_at = NULL, last_error = NULL WHERE id = ?")
        .run(runTimestamp, runTimestamp, task.id);

      try {
        const workspaceId = task.workspace_id;
        const agentId = task.assignee_id;

        const agentRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as any;
        if (!agentRow) throw new Error("Agent not found");

        const agent = {
          name: agentRow.name,
          avatar: agentRow.avatar,
          role: agentRow.role,
          description: agentRow.description,
          capabilities: agentRow.capabilities,
        };

        const taskExecutionType =
          task.execution_type ||
          inferTaskExecutionType({
            taskTitle: task.title,
            taskDescription: task.description,
            agentRole: agent.role,
          });

        let executionResult;
        if (aiClient) {
          let liveContext = {};
          let connectedServices = {};

          if (googleClientId && googleClientSecret) {
            try {
              const ctxResult = await fetchWorkspaceLiveContext(
                db as any,
                workspaceId,
                googleClientId,
                googleClientSecret,
              );
              liveContext = ctxResult.liveContext;
              connectedServices = ctxResult.connectedServices;
            } catch (ctxErr: any) {
              console.warn(
                `[Task Engine] Live context fetch failed for workspace ${workspaceId}: ${ctxErr.message}`,
              );
            }
          }

          try {
            checkAndIncrementDailyAIRequestLimit(db, workspaceId);
            executionResult = await buildAiTaskExecutionResult({
              taskTitle: task.title,
              taskDescription: task.description,
              agentName: agent.name,
              agentRole: agent.role,
              executionType: taskExecutionType,
              aiClient,
              agentDescription: agent.description,
              agentCapabilities: agent.capabilities,
              liveContext,
              connectedServices,
            });
          } catch (aiErr: any) {
            if (aiErr instanceof DailyLimitExceededError) {
              console.warn(`[Task Engine] Runaway limitation hit for workspace ${workspaceId}. Task ${task.id} aborted.`);
              throw aiErr;
            }
            console.warn(
              `[Task Engine] Gemini call failed for task ${task.id}, falling back to template: ${aiErr.message}`,
            );
            executionResult = buildTaskExecutionResult({
              taskTitle: task.title,
              taskDescription: task.description,
              agentName: agent.name,
              agentRole: agent.role,
              executionType: taskExecutionType,
            });
          }
        } else {
          executionResult = buildTaskExecutionResult({
            taskTitle: task.title,
            taskDescription: task.description,
            agentName: agent.name,
            agentRole: agent.role,
            executionType: taskExecutionType,
          });
        }

        db.prepare("UPDATE tasks SET status = 'done', execution_type = ?, artifact_type = ?, artifact_payload = ?, completed_at = ?, output_summary = ?, last_error = NULL WHERE id = ?")
          .run(
            executionResult.executionType,
            executionResult.artifact.type,
            JSON.stringify(executionResult.artifact),
            Date.now(),
            executionResult.outputSummary,
            task.id,
          );

        try {
          await maybeDispatchSocialAutomation(db, {
            ...task,
            output_summary: executionResult.outputSummary,
          }, executionResult.artifact as TaskArtifact);
        } catch (automationErr: any) {
          console.warn(
            `[Task Engine] Social automation skipped for task ${task.id}: ${automationErr.message}`,
          );
        }

        db.prepare("INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            createMessageId(workspaceId),
            workspaceId,
            agentId,
            agentId,
            agent.name,
            agent.avatar,
            executionResult.messageContent,
            Date.now(),
            "agent"
          );

        try {
          maybeEnqueueWorkspaceChannelAutomation(db, {
            ...task,
            output_summary: executionResult.outputSummary,
          }, executionResult.artifact as TaskArtifact);
        } catch (channelErr: any) {
          console.warn(
            `[Task Engine] Teams/Notion automation enqueue skipped for task ${task.id}: ${channelErr.message}`,
          );
        }
      } catch (err: any) {
        console.error(`[Task Engine] Failed to execute task ${task.id}: ${err.message}`);
        db.prepare("UPDATE tasks SET status = 'todo', artifact_type = NULL, artifact_payload = NULL, output_summary = NULL, completed_at = NULL, last_error = ? WHERE id = ?")
          .run(err.message, task.id);
      }
    }
  }
}

export function startTaskEngine({ db, pollIntervalMs = 60000, aiClient, googleClientId, googleClientSecret }: TaskEngineOptions) {
  const interval = setInterval(() => {
    void executePendingTasks({ db, aiClient, googleClientId, googleClientSecret });
    void processAutomationJobs(db);
  }, pollIntervalMs);
  console.log(`[Task Engine] Started. Polling every ${Math.round(pollIntervalMs / 1000)} seconds.`);
  return interval;
}
