import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { requestNotificationPermission, subscribeToPush } from '../services/notificationService';

interface NotificationPromptProps {
  token: string;
  workspaceId: number;
  swRegistration: ServiceWorkerRegistration;
  onDismiss: () => void;
}

export function NotificationPrompt({ token, workspaceId, swRegistration, onDismiss }: NotificationPromptProps) {
  const [loading, setLoading] = useState(false);

  async function handleEnable() {
    setLoading(true);
    try {
      const permission = await requestNotificationPermission();
      if (permission !== 'granted') {
        toast.error('Notification permission denied');
        onDismiss();
        return;
      }
      const ok = await subscribeToPush(swRegistration, token, workspaceId);
      if (ok) {
        toast.success('Notifications enabled — your agents will notify you!');
      } else {
        toast.error('Could not enable notifications. Please try again.');
      }
    } catch {
      toast.error('Could not enable notifications. Please try again.');
    } finally {
      setLoading(false);
      onDismiss();
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-white border border-warm-200 rounded-2xl shadow-xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
          <Bell className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-800 leading-snug">Enable notifications</p>
          <p className="text-xs text-stone-500 mt-0.5 leading-snug">Get alerted when your agents complete tasks, even when this tab is in the background.</p>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-stone-400 hover:text-stone-600 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleEnable}
          disabled={loading}
          className="flex-1 px-3 py-1.5 bg-brand-600 text-white rounded-xl text-xs font-bold hover:bg-brand-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Enabling…' : 'Enable Notifications'}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 bg-white border border-warm-200 text-stone-600 rounded-xl text-xs font-bold hover:bg-warm-100 transition-all"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
