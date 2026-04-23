import { useState, useEffect } from 'react';
import { Share, X } from 'lucide-react';

const DISMISSED_KEY = 'ios-install-dismissed';

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isInStandaloneMode() {
  return ('standalone' in navigator && (navigator as any).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export function IOSInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      isIosSafari() &&
      !isInStandaloneMode() &&
      !localStorage.getItem(DISMISSED_KEY)
    ) {
      // Short delay so it doesn't flash on every page load
      const t = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, '1');
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm bg-white border border-warm-200 rounded-2xl shadow-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center">
          <Share className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-800 leading-snug">Install on your iPhone</p>
          <p className="text-xs text-stone-500 mt-0.5 leading-snug">
            Tap <Share className="inline w-3 h-3 mx-0.5 text-stone-500" /> then <strong>"Add to Home Screen"</strong> to get push notifications and the full app experience.
          </p>
        </div>
        <button onClick={dismiss} className="flex-shrink-0 text-stone-400 hover:text-stone-600 transition-colors" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Pointer arrow pointing down toward the Safari share bar */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-r border-b border-warm-200 rotate-45" />
    </div>
  );
}
