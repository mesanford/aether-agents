function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.error('[Push] Service worker registration failed:', err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  token: string,
  workspaceId: number
): Promise<boolean> {
  try {
    const keyRes = await fetch('/api/notifications/vapid-public-key');
    if (!keyRes.ok) throw new Error('Failed to fetch VAPID public key');
    const { publicKey } = await keyRes.json() as { publicKey: string };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const subJson = subscription.toJSON() as {
      endpoint: string;
      keys?: { p256dh?: string; auth?: string };
    };

    const res = await fetch(`/api/workspaces/${workspaceId}/notifications/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
      }),
    });

    return res.ok;
  } catch (err) {
    console.error('[Push] Subscribe failed:', err);
    return false;
  }
}

export async function unsubscribeFromPush(
  registration: ServiceWorkerRegistration,
  token: string,
  workspaceId: number
): Promise<void> {
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await fetch(`/api/workspaces/${workspaceId}/notifications/subscribe`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    await subscription.unsubscribe();
  } catch (err) {
    console.error('[Push] Unsubscribe failed:', err);
  }
}
