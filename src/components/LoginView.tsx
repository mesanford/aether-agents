import React, { useState, useEffect } from 'react';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';

interface LoginViewProps {
  onLogin: (user: any, token: string) => void;
}

const BotanicalLeaves = () => (
  <svg viewBox="0 0 200 300" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <path d="M160 280 Q120 220 140 160 Q160 100 120 60" stroke="#7B9E5A" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6"/>
    <path d="M140 160 Q100 140 80 100" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
    <ellipse cx="100" cy="95" rx="28" ry="14" transform="rotate(-35 100 95)" fill="#7B9E5A" opacity="0.25"/>
    <path d="M140 160 Q180 145 190 110" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
    <ellipse cx="170" cy="122" rx="24" ry="12" transform="rotate(25 170 122)" fill="#7B9E5A" opacity="0.2"/>
    <path d="M120 200 Q80 180 60 145" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
    <ellipse cx="75" cy="155" rx="22" ry="11" transform="rotate(-45 75 155)" fill="#7B9E5A" opacity="0.2"/>
    <path d="M155 230 Q190 210 195 175" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
    <ellipse cx="180" cy="183" rx="20" ry="10" transform="rotate(15 180 183)" fill="#7B9E5A" opacity="0.18"/>
    <circle cx="145" cy="158" r="3" fill="#7B9E5A" opacity="0.4"/>
    <circle cx="122" cy="200" r="2.5" fill="#7B9E5A" opacity="0.35"/>
    <circle cx="158" cy="230" r="2" fill="#7B9E5A" opacity="0.3"/>
  </svg>
);

const BotanicalTop = () => (
  <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <path d="M40 0 Q60 50 40 100 Q20 140 50 160" stroke="#7B9E5A" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5"/>
    <path d="M40 60 Q10 50 5 25" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
    <ellipse cx="18" cy="30" rx="20" ry="10" transform="rotate(-20 18 30)" fill="#7B9E5A" opacity="0.2"/>
    <path d="M38 100 Q10 90 8 65" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
    <ellipse cx="16" cy="70" rx="18" ry="9" transform="rotate(-30 16 70)" fill="#7B9E5A" opacity="0.18"/>
    <path d="M42 60 Q70 48 72 22" stroke="#7B9E5A" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4"/>
    <ellipse cx="60" cy="28" rx="18" ry="9" transform="rotate(20 60 28)" fill="#7B9E5A" opacity="0.18"/>
  </svg>
);

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        onLogin(event.data.user, event.data.token);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onLogin]);

  const handleGoogleLogin = async () => {
    try {
      const popup = window.open('', 'google_login', 'width=500,height=600');
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      if (popup) {
        popup.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      setError('Failed to initialize Google login');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const body = isLogin ? { email, password } : { email, password, name };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Authentication failed');
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-warm-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-72 h-72 rounded-full bg-brand-200/30 blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-warm-300/50 blur-3xl translate-x-1/3 translate-y-1/3" />
        <div className="absolute top-1/3 right-1/4 w-48 h-48 rounded-full bg-brand-100/40 blur-2xl" />
      </div>

      {/* Botanical — bottom right */}
      <div className="absolute bottom-0 right-0 w-48 h-72 pointer-events-none opacity-70">
        <BotanicalLeaves />
      </div>

      {/* Botanical — top left */}
      <div className="absolute top-0 left-0 w-36 h-36 pointer-events-none opacity-60">
        <BotanicalTop />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-3xl shadow-xl shadow-warm-300/40 p-8 sm:p-10">
        {/* Logo + heading */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-500 mb-5">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold text-stone-900 tracking-tight">
            {isLogin ? 'Welcome back!' : 'Create your account'}
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            {isLogin ? 'Sign in to your account' : 'Start your free trial today'}
          </p>
        </div>

        <div className="space-y-5">
          {/* Google */}
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white ring-1 ring-warm-300 rounded-2xl text-sm font-medium text-stone-700 hover:bg-warm-50 hover:ring-warm-400 transition-all"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-warm-200" />
            <span className="text-xs text-stone-400 font-medium">or</span>
            <div className="flex-1 h-px bg-warm-200" />
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {!isLogin && (
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full pl-10 pr-4 py-3 bg-warm-50 ring-1 ring-warm-200 rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full pl-10 pr-4 py-3 bg-warm-50 ring-1 ring-warm-200 rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full pl-10 pr-4 py-3 bg-warm-50 ring-1 ring-warm-200 rounded-xl text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-all"
              />
            </div>

            {error && (
              <div className="text-red-600 text-sm font-medium text-center bg-red-50 py-2.5 px-4 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-between py-3.5 px-5 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold text-sm transition-all shadow-md shadow-brand-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isLogin ? 'Sign in to your dashboard' : 'Create account'}</span>
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </button>
          </form>

          {/* Toggle */}
          <p className="text-center text-sm text-stone-500">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
