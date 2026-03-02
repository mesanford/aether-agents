import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserPlus, MoreVertical, Trash2, Mail, Shield, ShieldCheck } from 'lucide-react';
import { cn } from '../utils';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member';
  joinedDate: string;
  avatar: string;
}

export const TeamManagement: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([
    {
      id: '1',
      name: 'Marcus Sanford',
      email: 'marcus@msanford.com',
      role: 'Owner',
      joinedDate: '2/4/2026',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus'
    }
  ]);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: 'Member',
      joinedDate: new Date().toLocaleDateString(),
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${inviteEmail}`
    };

    setMembers([...members, newMember]);
    setInviteEmail('');
    setIsInviteModalOpen(false);
  };

  const removeMember = (id: string) => {
    if (members.find(m => m.id === id)?.role === 'Owner') return;
    setMembers(members.filter(m => m.id !== id));
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-8 py-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Team</h1>
          <p className="text-sm text-slate-500 mt-2">
            You're currently using <span className="font-bold text-slate-700">{members.length} out of 5 seats</span> • 
            <button className="text-brand-600 hover:underline ml-1">Add Seats</button> • 
            <button className="text-brand-600 hover:underline ml-1">Manage Seats</button>
          </p>
        </div>
        <button 
          onClick={() => setIsInviteModalOpen(true)}
          className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all flex items-center gap-2 shadow-lg shadow-slate-200"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-50">
                <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Member</th>
                <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Role</th>
                <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Joined</th>
                <th className="px-8 py-5 text-[11px] font-bold uppercase tracking-wider text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {members.map((member) => (
                <tr key={member.id} className="group hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                        <img src={member.avatar} alt={member.name} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{member.name}</p>
                        <p className="text-xs text-slate-500 font-medium">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2">
                      {member.role === 'Owner' ? (
                        <ShieldCheck className="w-4 h-4 text-brand-600" />
                      ) : (
                        <Shield className="w-4 h-4 text-slate-400" />
                      )}
                      <span className="text-sm font-medium text-slate-700">{member.role}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-sm font-medium text-slate-500">{member.joinedDate}</span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    {member.role !== 'Owner' && (
                      <button 
                        onClick={() => removeMember(member.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
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
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
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
                  <h3 className="text-xl font-bold text-slate-900">Invite Team Member</h3>
                  <p className="text-sm text-slate-500">Add a new user to your workspace</p>
                </div>
              </div>

              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
                  <input 
                    autoFocus
                    type="email" 
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20"
                  >
                    Send Invite
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
