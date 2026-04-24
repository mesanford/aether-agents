import crypto from 'crypto';
import express from 'express';
import type { PostgresShim } from './db.ts';
import { workflow } from './ai/graph.ts';
import { HumanMessage } from '@langchain/core/messages';
import { checkAndIncrementDailyAIRequestLimit, DailyLimitExceededError } from './ai/rateLimiterUtility.ts';
import { sendPushToWorkspace } from './notificationSender.ts';

/**
 * Zernio Webhook Handler
 * 
 * Receives real-time events from Zernio (message.received, message.sent,
 * message.delivered, message.read, message.failed, post.published, etc.)
 * and dispatches reactive agent actions.
 *
 * Key reactive behaviors:
 * - message.received  → Stan gets notified of a reply, can auto-pause sequence & follow up
 * - message.failed    → Stan gets alerted, can retry or adjust the sequence
 * - message.delivered → Logged for analytics
 * - message.read      → Logged for analytics
 * - post.published    → Social media agent gets notified for engagement monitoring
 * - account.disconnected → Alert user + pause dependent sequences
 */

// ──────────────────────────────────────────
// SIGNATURE VERIFICATION
// ──────────────────────────────────────────

function verifyZernioSignature(payload: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

// ──────────────────────────────────────────
// EVENT TYPES WE CARE ABOUT
// ──────────────────────────────────────────

const SEQUENCE_REACTIVE_EVENTS = new Set([
  'message.received',
  'message.failed',
  'message.delivered',
  'message.read',
]);

const ACCOUNT_EVENTS = new Set([
  'account.connected',
  'account.disconnected',
]);

const POST_EVENTS = new Set([
  'post.published',
  'post.failed',
  'post.partial',
]);

// ──────────────────────────────────────────
// MAIN HANDLER SETUP
// ──────────────────────────────────────────

export function mountZernioWebhook(app: express.Application, db: PostgresShim) {
  const WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET || '';

  app.post('/api/webhooks/zernio', async (req, res) => {
    try {
      // 1. Fast ACK: Zernio expects 2xx quickly
      const rawBody = JSON.stringify(req.body);
      const event = req.body;
      const eventId = event?.id;
      const eventType = event?.event;
      const timestamp = event?.timestamp || new Date().toISOString();

      if (!eventType) {
        return res.status(400).json({ error: 'Missing event type' });
      }

      // 2. Signature verification (if secret is configured)
      if (WEBHOOK_SECRET) {
        const signature = req.get('X-Zernio-Signature') || '';
        if (!verifyZernioSignature(rawBody, signature, WEBHOOK_SECRET)) {
          console.warn('[ZERNIO-WEBHOOK] Signature verification failed');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }

      // 3. Deduplication by event ID
      if (eventId) {
        const existing = await db.prepare(
          'SELECT id FROM zernio_webhook_events WHERE event_id = ?'
        ).get(eventId) as any;
        if (existing) {
          console.log(`[ZERNIO-WEBHOOK] Duplicate event ${eventId}, skipping.`);
          return res.status(200).json({ ok: true, deduplicated: true });
        }
      }

      // 4. ACK immediately, process async
      res.status(200).json({ ok: true });

      // 5. Store event for deduplication + audit
      if (eventId) {
        await db.prepare(
          'INSERT INTO zernio_webhook_events (event_id, event_type, payload, received_at) VALUES (?, ?, ?, ?)'
        ).run(eventId, eventType, rawBody, new Date().toISOString());
      }

      console.log(`[ZERNIO-WEBHOOK] Processing event: ${eventType} (${eventId || 'no-id'})`);

      // 6. Route to handler
      if (SEQUENCE_REACTIVE_EVENTS.has(eventType)) {
        await handleSequenceEvent(db, event);
      } else if (ACCOUNT_EVENTS.has(eventType)) {
        await handleAccountEvent(db, event);
      } else if (POST_EVENTS.has(eventType)) {
        await handlePostEvent(db, event);
      } else if (eventType === 'webhook.test') {
        console.log('[ZERNIO-WEBHOOK] Test event received successfully.');
      } else {
        console.log(`[ZERNIO-WEBHOOK] Unhandled event type: ${eventType}`);
      }
    } catch (err: any) {
      console.error('[ZERNIO-WEBHOOK] Handler error:', err.message);
      // Still return 200 if we haven't responded yet (shouldn't happen due to early ACK)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error' });
      }
    }
  });

  console.log('[ZERNIO-WEBHOOK] Mounted at POST /api/webhooks/zernio');
}

// ──────────────────────────────────────────
// SEQUENCE EVENT HANDLERS (message.*)
// ──────────────────────────────────────────

async function handleSequenceEvent(db: PostgresShim, event: any) {
  const eventType = event.event;
  const message = event.message || {};
  const conversation = event.conversation || {};
  const account = event.account || {};

  // Try to match this to a local lead by the conversation participant info
  const contactId = conversation?.contactId || message?.from?.id;
  const contactName = message?.from?.name || conversation?.contactName;

  if (eventType === 'message.received') {
    // ──── REPLY DETECTED ────
    // This is the most important reactive event. When a prospect replies,
    // Stan should pause the sequence and potentially craft a follow-up.
    console.log(`[ZERNIO-WEBHOOK] Reply received from ${contactName || contactId}`);

    // Find the lead and active enrollment
    const lead = contactId
      ? await db.prepare('SELECT * FROM leads WHERE zernio_contact_id = ?').get(contactId) as any
      : null;

    if (lead) {
      // Find active enrollment for this lead
      const enrollment = await db.prepare(`
        SELECT e.*, s.title as seq_title, s.exit_on_reply
        FROM sequence_enrollments e
        JOIN sales_sequences s ON e.sequence_id = s.id
        WHERE e.lead_id = ? AND e.status = 'Active'
        ORDER BY e.created_at DESC LIMIT 1
      `).get(lead.id) as any;

      if (enrollment) {
        // Log the reply event
        await db.prepare(
          'INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          enrollment.workspace_id, lead.id, enrollment.sequence_id,
          'Reply Received',
          `Reply from ${contactName}: ${message.text || '(media/attachment)'}`,
          'Webhook-triggered. Dispatching Stan for follow-up.'
        );

        // Auto-pause if exit_on_reply is enabled
        if (enrollment.exit_on_reply) {
          await db.prepare("UPDATE sequence_enrollments SET status = 'Completed' WHERE id = ?").run(enrollment.id);
          console.log(`[ZERNIO-WEBHOOK] Auto-completed enrollment ${enrollment.id} (exit_on_reply)`);
        }

        // Dispatch Stan for a reactive follow-up
        await dispatchReactiveAgent(db, enrollment.workspace_id, `
[SEQUENCE REPLY ALERT]
Lead "${lead.name}" (${lead.email || lead.company || 'unknown'}) has REPLIED to your outreach sequence "${enrollment.seq_title}".

Reply content: "${message.text || '(non-text message)'}"
Platform: ${account.platform || 'unknown'}
Conversation ID: ${conversation.id || 'unknown'}

ACTION REQUIRED:
1. Analyze the reply sentiment — is it positive, neutral, or negative?
2. If positive: celebrate internally and craft a personalized follow-up using get_sequence_analytics to check context.
3. If negative/unsubscribe: ensure the sequence is paused and mark the lead appropriately.
4. Send the user a push notification about this reply using send_push_notification.
5. Log your analysis to memory using write_to_memory.
        `);
      }
    }

    // Notify the specific workspace that owns this lead (or broadcast if unresolved)
    if (lead) {
      const ownerWorkspace = lead.workspace_id;
      try {
        await sendPushToWorkspace(ownerWorkspace, {
          title: '💬 Sequence Reply',
          message: `${contactName || 'A prospect'} replied to your outreach: "${(message.text || '').slice(0, 80)}..."`,
          url: '/?agent=sales-associate'
        });
      } catch { /* best-effort */ }
    } else {
      // Contact not matched to any workspace — broadcast as fallback
      await notifyAllWorkspaces(db, {
        title: '💬 New Inbox Reply',
        message: `${contactName || 'Someone'} sent a message: "${(message.text || '').slice(0, 80)}..."`,
        url: '/?agent=sales-associate'
      });
    }

  } else if (eventType === 'message.failed') {
    // ──── DELIVERY FAILURE ────
    console.log(`[ZERNIO-WEBHOOK] Message delivery failed for ${contactName || contactId}`);

    const lead = contactId
      ? await db.prepare('SELECT * FROM leads WHERE zernio_contact_id = ?').get(contactId) as any
      : null;

    if (lead) {
      const enrollment = await db.prepare(`
        SELECT e.*, s.title as seq_title
        FROM sequence_enrollments e
        JOIN sales_sequences s ON e.sequence_id = s.id
        WHERE e.lead_id = ? AND e.status = 'Active'
        ORDER BY e.created_at DESC LIMIT 1
      `).get(lead.id) as any;

      if (enrollment) {
        const errorInfo = event.error || {};
        await db.prepare(
          'INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          enrollment.workspace_id, lead.id, enrollment.sequence_id,
          'Delivery Failed',
          `Failed to deliver message to ${contactName}. Error: ${errorInfo.title || errorInfo.message || 'Unknown'}`,
          'Webhook-triggered. Agent should evaluate whether to retry or skip.'
        );

        // Dispatch Stan to handle the failure
        await dispatchReactiveAgent(db, enrollment.workspace_id, `
[SEQUENCE DELIVERY FAILURE]
A message in sequence "${enrollment.seq_title}" failed to deliver to lead "${lead.name}".

Error: ${errorInfo.title || 'Unknown'} - ${errorInfo.message || 'No details'}
Error Code: ${errorInfo.code || 'N/A'}
Platform: ${account.platform || 'unknown'}

ACTION REQUIRED:
1. Check if this is a transient error or a permanent failure.
2. If the contact is unreachable, pause their enrollment and note it in CRM.
3. If transient, the step will be retried automatically by Zernio.
4. Send a push notification to the user about this delivery issue.
        `);
      }
    }

  } else if (eventType === 'message.delivered' || eventType === 'message.read') {
    // ──── DELIVERY/READ CONFIRMATION ────
    // Log for analytics but don't dispatch agent (too noisy)
    const lead = contactId
      ? await db.prepare('SELECT id FROM leads WHERE zernio_contact_id = ?').get(contactId) as any
      : null;

    if (lead) {
      const enrollment = await db.prepare(`
        SELECT e.workspace_id, e.sequence_id FROM sequence_enrollments e
        WHERE e.lead_id = ? AND e.status = 'Active'
        ORDER BY e.created_at DESC LIMIT 1
      `).get(lead.id) as any;

      if (enrollment) {
        const label = eventType === 'message.delivered' ? 'Message Delivered' : 'Message Read';
        await db.prepare(
          'INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          enrollment.workspace_id, lead.id, enrollment.sequence_id,
          label,
          `${label} at ${event.statusTimestamp || new Date().toISOString()}`,
          'Auto-logged via webhook.'
        );
      }
    }
  }
}

// ──────────────────────────────────────────
// ACCOUNT EVENT HANDLERS
// ──────────────────────────────────────────

async function handleAccountEvent(db: PostgresShim, event: any) {
  const account = event.account || {};
  const eventType = event.event;

  if (eventType === 'account.disconnected') {
    console.warn(`[ZERNIO-WEBHOOK] Account disconnected: ${account.platform} - ${account.name || account.id}`);

    // Pause all sequences using this platform
    const affected = await db.prepare(`
      UPDATE sales_sequences SET status = 'Paused', updated_at = CURRENT_TIMESTAMP
      WHERE platform = ? AND status = 'Active' AND zernio_sequence_id IS NOT NULL
    `).run(account.platform || 'linkedin');

    // Notify user
    await notifyAllWorkspaces(db, {
      title: '⚠️ Account Disconnected',
      message: `Your ${account.platform || 'social'} account "${account.name || 'unknown'}" was disconnected. Active sequences have been paused.`,
      url: '/?agent=sales-associate'
    });

  } else if (eventType === 'account.connected') {
    console.log(`[ZERNIO-WEBHOOK] Account connected: ${account.platform} - ${account.name || account.id}`);

    await notifyAllWorkspaces(db, {
      title: '✅ Account Connected',
      message: `Your ${account.platform || 'social'} account "${account.name || ''}" is now connected and ready for sequences.`,
      url: '/?agent=sales-associate'
    });
  }
}

// ──────────────────────────────────────────
// POST EVENT HANDLERS (for social agent)
// ──────────────────────────────────────────

async function handlePostEvent(db: PostgresShim, event: any) {
  const eventType = event.event;
  const post = event.post || {};

  if (eventType === 'post.failed') {
    await notifyAllWorkspaces(db, {
      title: '❌ Post Failed',
      message: `A scheduled post failed to publish${post.title ? ': ' + post.title.slice(0, 60) : ''}.`,
      url: '/?agent=social-media-manager'
    });
  } else if (eventType === 'post.published') {
    console.log(`[ZERNIO-WEBHOOK] Post published successfully: ${post.id || 'unknown'}`);
  }
}

// ──────────────────────────────────────────
// REACTIVE AGENT DISPATCH
// ──────────────────────────────────────────

async function dispatchReactiveAgent(db: PostgresShim, workspaceId: number, prompt: string) {
  try {
    // Rate limit check
    await checkAndIncrementDailyAIRequestLimit(db, workspaceId);

    // Load agent profiles for the workspace
    const profiles = await db.prepare(
      'SELECT id, name, role, instructions, personality, capabilities, description FROM agents WHERE workspace_id = ?'
    ).all(workspaceId) as any[];

    const agentProfiles: Record<string, string> = {};
    const agentNames: Record<string, string> = {};
    for (const a of profiles) {
      agentProfiles[a.id] = `Role: ${a.role}\nDescription: ${a.description}\nPersonality: ${a.personality}\nInstructions: ${a.instructions}\nCapabilities: ${a.capabilities}`;
      if (a.name) agentNames[a.id] = a.name;
    }

    // Invoke the LangGraph workflow with the reactive prompt
    const threadId = `webhook_reactive_${workspaceId}_${Date.now()}`;
    await workflow.invoke({
      messages: [new HumanMessage(prompt)],
      task: prompt,
      sender: 'system_webhook',
      dataAccessSection: '',
      liveDataSection: '',
      agentProfiles,
      agentNames,
      tenantId: workspaceId.toString(),
      clientId: 'system_webhook_handler'
    }, { configurable: { thread_id: threadId }, recursionLimit: 15 });

    console.log(`[ZERNIO-WEBHOOK] Reactive agent dispatch completed for workspace ${workspaceId}`);
  } catch (err: any) {
    if (err instanceof DailyLimitExceededError) {
      console.warn(`[ZERNIO-WEBHOOK] Rate limit exceeded for workspace ${workspaceId}. Skipping agent dispatch.`);
    } else {
      console.error(`[ZERNIO-WEBHOOK] Agent dispatch failed:`, err.message);
    }
  }
}

// ──────────────────────────────────────────
// PUSH NOTIFICATION HELPER
// ──────────────────────────────────────────

async function notifyAllWorkspaces(db: PostgresShim, notification: { title: string; message: string; url: string }) {
  try {
    // Get all workspace IDs that have sequences (i.e., are active Zernio users)
    const workspaces = await db.prepare(
      'SELECT DISTINCT workspace_id FROM sales_sequences LIMIT 10'
    ).all() as any[];

    for (const ws of workspaces) {
      try {
        await sendPushToWorkspace(ws.workspace_id, notification);
      } catch {
        // Best-effort notification
      }
    }
  } catch {
    // Best-effort
  }
}

// ──────────────────────────────────────────
// AUTO-REGISTRATION ON STARTUP
// ──────────────────────────────────────────

export async function registerZernioWebhook() {
  const apiKey = process.env.ZERNIO_API_KEY;
  const appUrl = process.env.APP_URL;
  const webhookSecret = process.env.ZERNIO_WEBHOOK_SECRET;

  if (!apiKey || !appUrl) {
    console.log('[ZERNIO-WEBHOOK] Skipping auto-registration (ZERNIO_API_KEY or APP_URL not set).');
    return;
  }

  const webhookUrl = `${appUrl}/api/webhooks/zernio`;
  const desiredEvents = [
    'message.received',
    'message.sent',
    'message.delivered',
    'message.read',
    'message.failed',
    'post.published',
    'post.failed',
    'account.connected',
    'account.disconnected',
    'comment.received',
  ];

  try {
    // Check existing webhooks
    const existingRes = await fetch('https://zernio.com/api/v1/webhooks/settings', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const existingData = await existingRes.json() as any;
    const webhooks = existingData.webhooks || [];

    // Find our webhook by URL (may be active or disabled after failures)
    const ours = webhooks.find((wh: any) => wh.url === webhookUrl);

    if (ours && ours.isActive) {
      console.log('[ZERNIO-WEBHOOK] Webhook already registered and active.');
      return;
    }

    if (ours && !ours.isActive) {
      // Re-enable — likely auto-disabled after 10 consecutive failures
      console.log(`[ZERNIO-WEBHOOK] Found disabled webhook (failureCount: ${ours.failureCount || '?'}). Re-enabling...`);
      const updateRes = await fetch('https://zernio.com/api/v1/webhooks/settings', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          _id: ours._id,
          isActive: true,
          events: desiredEvents,
          secret: webhookSecret || undefined,
        })
      });

      if (updateRes.ok) {
        console.log('[ZERNIO-WEBHOOK] Successfully re-enabled webhook.');
      } else {
        const errData = await updateRes.json() as any;
        console.warn('[ZERNIO-WEBHOOK] Failed to re-enable webhook:', errData.error || errData.message || updateRes.status);
      }
      return;
    }

    // No matching webhook found — create new one
    const createRes = await fetch('https://zernio.com/api/v1/webhooks/settings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Aether Agents',
        url: webhookUrl,
        secret: webhookSecret || undefined,
        events: desiredEvents,
        isActive: true,
      })
    });

    if (createRes.ok) {
      console.log('[ZERNIO-WEBHOOK] Successfully registered new webhook with Zernio.');
    } else {
      const errData = await createRes.json() as any;
      console.warn('[ZERNIO-WEBHOOK] Failed to register webhook:', errData.error || errData.message || createRes.status);
    }
  } catch (err: any) {
    console.warn('[ZERNIO-WEBHOOK] Auto-registration failed:', err.message);
  }
}
