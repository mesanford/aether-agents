import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserPlus, MoreVertical, Trash2, Mail, Shield, ShieldCheck, Send, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  avatar?: string;
}

interface Invite {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'pending' | 'accepted';
  created_at: string;
}

interface TeamManagementProps {
  activeWorkspaceId: number | null;
  token: string | null;
  onAuthFailure?: () => void;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ activeWorkspaceId, token, onAuthFailure }) => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchTeamData = async () => {
    if (!activeWorkspaceId || !token) return;
    setIsLoading(true);
    try {
      const [membersData, invitesData] = await Promise.all([
        apiFetch(`/api/workspaces/${activeWorkspaceId}/members`, { token, onAuthFailure }),
        apiFetch(`/api/workspaces/${activeWorkspaceId}/invites`, { token, onAuthFailure })
      ]);
      setMembers(membersData.map((m: any) => ({
        ...m,
        avatar: `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${m.email}`
      })));
      setInvites(invitesData);
    } catch (err) {
      console.error('Failed to fetch team data', err);
      toast.error('Failed to load team data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamData();
  }, [activeWorkspaceId, token]);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !token || !activeWorkspaceId) return;

    setIsSubmitting(true);
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/invites`, {
        method: 'POST',
        token,
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        onAuthFailure
      });
      toast.success('Invitation sent successfully!');
      setInviteEmail('');
      setInviteRole('member');
      setIsInviteModalOpen(false);
      fetchTeamData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invite');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateMemberRole = async (memberId: number, newRole: 'admin' | 'member') => {
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${memberId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ role: newRole }),
        onAuthFailure
      });
      toast.success('Member role updated');
      fetchTeamData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role');
    }
  };

  const removeMember = async (id: number) => {
    if (members.find(m => m.id === id)?.role === 'owner') return;
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/members/${id}`, {
        method: 'DELETE',
        token,
        onAuthFailure
      });
      toast.success('Member removed');
      fetchTeamData();
    } catch (err) {
      toast.error('Failed to remove member');
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
        token,
        onAuthFailure
      });
      toast.success('Invitation revoked');
      fetchTeamData();
    } catch (err) {
      toast.error('Failed to revoke invitation');
    }
  };

  const resendInvite = async (inviteId: string) => {
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/invites/${inviteId}/resend`, {
        method: 'POST',
        token,
        onAuthFailure
      });
      toast.success('Invitation resent');
    } catch (err) {
      toast.error('Failed to resend invitation');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-8 py-6 md:py-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-stone-900">Team</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-1 md:mt-2">
            {isLoading ? (
              <span className="animate-pulse">Loading members...</span>
            ) : (
              <>
                <span className="font-bold text-stone-700">{members.length} / 5 seats</span> • 
                <button className="text-brand-600 hover:underline ml-1">Add Seats</button>
              </>
            )}
          </p>
        </div>
        <button 
          onClick={() => setIsInviteModalOpen(true)}
          className="px-6 py-2.5 bg-stone-900 text-white rounded-xl text-sm font-bold hover:bg-stone-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-200"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-8">
        <div className="bg-white border border-warm-200 rounded-2xl md:rounded-3xl overflow-x-auto shadow-sm">
          <table className="w-full text-left border-collapse min-w-[600px] md:min-w-0">
            <thead>
              <tr className="border-b border-warm-200">
                <th className="px-6 md:px-8 py-4 md:py-5 text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-stone-400">Member</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-stone-400">Role</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-stone-400">Status</th>
                <th className="px-6 md:px-8 py-4 md:py-5 text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-stone-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {members.map((member) => (
                <tr key={member.id} className="group hover:bg-warm-50/50 transition-colors">
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-warm-100 overflow-hidden border border-warm-200 flex-shrink-0">
                        <img src={member.avatar} alt={member.name} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-stone-900 truncate capitalize">{member.name}</p>
                        <p className="text-xs text-stone-500 font-medium truncate">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <div className="flex items-center gap-2">
                      {member.role === 'owner' ? (
                        <>
                          <ShieldCheck className="w-4 h-4 text-brand-600" />
                          <span className="text-sm font-medium text-stone-700 capitalize">{member.role}</span>
                        </>
                      ) : (
                        <select
                          className="bg-transparent text-sm font-medium text-stone-700 capitalize outline-none cursor-pointer hover:text-brand-600 transition-colors"
                          value={member.role}
                          onChange={(e) => updateMemberRole(member.id, e.target.value as 'admin' | 'member')}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      Active
                    </span>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5 text-right">
                    {member.role !== 'owner' && (
                      <button 
                        onClick={() => removeMember(member.id)}
                        className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {invites.filter(i => i.status === 'pending').map((invite) => (
                <tr key={invite.id} className="group hover:bg-warm-50/50 transition-colors bg-warm-50/20">
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <div className="flex items-center gap-3 md:gap-4 opacity-60">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-warm-100 overflow-hidden border border-warm-200 border-dashed flex-shrink-0 flex items-center justify-center text-stone-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-stone-500 truncate capitalize">{invite.email.split('@')[0]}</p>
                        <p className="text-xs text-stone-400 font-medium truncate">{invite.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <div className="flex items-center gap-2 opacity-60">
                      <Shield className="w-4 h-4 text-stone-400" />
                      <span className="text-sm font-medium text-stone-500 capitalize">{invite.role}</span>
                    </div>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      Pending
                    </span>
                  </td>
                  <td className="px-6 md:px-8 py-4 md:py-5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button 
                        onClick={() => resendInvite(invite.id)}
                        title="Resend Invite"
                        className="p-2 text-stone-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => revokeInvite(invite.id)}
                        title="Revoke Invite"
                        className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      <AnimatePresence>
        {isInviteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsInviteModalOpen(false)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center text-brand-600">
                  <Mail className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-stone-900">Invite Team Member</h3>
                  <p className="text-sm text-stone-500">Add a new user to your workspace</p>
                </div>
              </div>

              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Email Address</label>
                  <input 
                    autoFocus
                    type="email" 
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full px-4 py-3 bg-warm-50 border border-warm-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Workspace Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                    className="w-full px-4 py-3 bg-warm-50 border border-warm-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all appearance-none"
                  >
                    <option value="member">Member (View & Use Agents)</option>
                    <option value="admin">Admin (Edit Agents & Settings)</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="flex-1 px-4 py-3 bg-warm-100 text-stone-600 rounded-xl text-sm font-bold hover:bg-warm-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting || !inviteEmail}
                    className="flex-1 px-4 py-3 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Invite'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
