import webpush from 'web-push';
import db from './db.js';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export interface PushPayload {
  title: string;
  message: string;
  url?: string;
  tag?: string;
}

export async function sendPushToWorkspace(
  workspaceId: number,
  payload: PushPayload
): Promise<{ sent: number; failed: number; removed: number }> {
  const subs = await db.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE workspace_id = ?'
  ).all(workspaceId) as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;

  let sent = 0, failed = 0, removed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        removed++;
      } else {
        console.error(`[Push] Failed for endpoint ${sub.endpoint.slice(0, 60)}:`, err.message);
        failed++;
      }
    }
  }

  return { sent, failed, removed };
}
