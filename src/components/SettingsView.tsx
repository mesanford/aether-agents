import React, { useState } from 'react';
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
  ExternalLink
} from 'lucide-react';
import { cn } from '../utils';

interface SettingsViewProps {
  user: any;
  onLogout: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'account' | 'integrations'>('account');

  const integrations = [
    { id: 'wordpress', name: 'WordPress', icon: Globe, description: 'Post blogs directly to your site', connected: true },
    { id: 'linkedin', name: 'LinkedIn', icon: Linkedin, description: 'Automate social media posts', connected: false },
    { id: 'gmail', name: 'Gmail', icon: Mail, description: 'Manage emails and follow-ups', connected: true },
    { id: 'workspace', name: 'Google Workspace', icon: Layout, description: 'Sync documents and calendars', connected: false },
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
                        onClick={() => alert(`Connecting to ${integration.name}...`)}
                        className="flex items-center gap-1 px-3 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Connect
                      </button>
                    )}
                  </div>
                  <h3 className="font-bold text-slate-900 mb-1">{integration.name}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-4">{integration.description}</p>
                  
                  {integration.connected && (
                    <button 
                      onClick={() => alert(`Configuring ${integration.name}...`)}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1"
                    >
                      Configure <ExternalLink className="w-3 h-3" />
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
