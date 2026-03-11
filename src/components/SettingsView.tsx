import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  User,
  Lock,
  LogOut,
  Globe,
  Linkedin,
  Mail,
  Layout,
  CheckCircle2,
  Plus,
  ExternalLink,
  Loader,
  Unplug
} from 'lucide-react';
import { cn } from '../utils';

interface SettingsViewProps {
  user: any;
  token: string | null;
  onLogout: () => void;
}

interface GoogleStatus {
  connected: boolean;
  gmail: boolean;
  calendar: boolean;
  drive: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ user, token, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'account' | 'integrations'>('account');
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, gmail: false, calendar: false, drive: false });
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/integrations/google/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setGoogleStatus(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [token]);

  const handleConnectGoogle = async () => {
    if (!token) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/integrations/google/connect', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { url } = await res.json();

      const popup = window.open(url, 'google-workspace-auth', 'width=500,height=650,scrollbars=yes');

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'WORKSPACE_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          fetchStatus();
          setConnecting(false);
        } else if (event.data?.type === 'WORKSPACE_AUTH_ERROR') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          alert(`Connection failed: ${event.data.error}`);
          setConnecting(false);
        }
      };
      window.addEventListener('message', handleMessage);

      // Poll for popup close
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          window.removeEventListener('message', handleMessage);
          setConnecting(false);
          fetchStatus();
        }
      }, 500);
    } catch (err) {
      console.error('Failed to start Google connect:', err);
      setConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!token) return;
    setDisconnecting(true);
    try {
      await fetch('/api/integrations/google', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setGoogleStatus({ connected: false, gmail: false, calendar: false, drive: false });
    } catch {
      // ignore
    } finally {
      setDisconnecting(false);
    }
  };

  const integrations = [
    {
      id: 'google-workspace',
      name: 'Google Workspace',
      icon: Layout,
      description: 'Gmail, Calendar, Drive, Docs & Slides',
      connected: googleStatus.connected,
      services: [
        { name: 'Gmail', connected: googleStatus.gmail },
        { name: 'Calendar', connected: googleStatus.calendar },
        { name: 'Drive / Docs / Slides', connected: googleStatus.drive },
      ],
      onConnect: handleConnectGoogle,
      onDisconnect: handleDisconnectGoogle,
      isLoading: connecting || disconnecting,
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      icon: Linkedin,
      description: 'Automate social media posts',
      connected: false,
      services: [],
      onConnect: () => alert('LinkedIn integration coming soon!'),
      onDisconnect: null,
      isLoading: false,
    },
    {
      id: 'wordpress',
      name: 'WordPress',
      icon: Globe,
      description: 'Post blogs directly to your site',
      connected: false,
      services: [],
      onConnect: () => alert('WordPress integration coming soon!'),
      onDisconnect: null,
      isLoading: false,
    },
  ];

  return (
    <div className="flex-1 flex flex-col bg-slate-50/50 overflow-hidden">
      <div className="px-8 py-6 bg-white border-b border-slate-100">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your account and connected services</p>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('account')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'account' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Account
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                activeTab === 'integrations' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Integrations
            </button>
          </div>

          {activeTab === 'account' ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <User className="w-5 h-5 text-brand-500" />
                  Profile Information
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Name</label>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-900 font-medium">{user.name}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Email</label>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-slate-900 font-medium">{user.email}</span>
                    </div>
                  </div>

                  <div className="pt-4">
                    <button
                      onClick={() => alert('Password change functionality coming soon!')}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Lock className="w-4 h-4" />
                      Change Password
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 mb-4">Session</h2>
                <p className="text-slate-500 text-sm mb-6">Manage your active session and security</p>

                <button
                  onClick={onLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log Out
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm hover:border-brand-200 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                      <integration.icon className="w-6 h-6" />
                    </div>
                    {integration.connected ? (
                      <span className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" />
                        Connected
                      </span>
                    ) : (
                      <button
                        onClick={integration.onConnect}
                        disabled={integration.isLoading}
                        className="flex items-center gap-1 px-3 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-60"
                      >
                        {integration.isLoading ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <Plus className="w-3 h-3" />
                        )}
                        {integration.isLoading ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>

                  <h3 className="font-bold text-slate-900 mb-1">{integration.name}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-3">{integration.description}</p>

                  {/* Show per-service status when connected */}
                  {integration.connected && integration.services.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {integration.services.map((svc) => (
                        <span
                          key={svc.name}
                          className={cn(
                            "text-[10px] font-medium px-2 py-0.5 rounded-full",
                            svc.connected ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"
                          )}
                        >
                          {svc.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {integration.connected && (
                    <button
                      onClick={integration.onDisconnect ?? undefined}
                      disabled={integration.isLoading}
                      className="text-xs font-medium text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors disabled:opacity-60"
                    >
                      <Unplug className="w-3 h-3" />
                      {integration.isLoading ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  )}
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
