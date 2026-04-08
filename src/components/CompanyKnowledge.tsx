import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Edit2, Save, Building2, Users, Globe, Info, FileText, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';

interface CompanyKnowledgeProps {
  activeWorkspaceId: number | null;
  workspace?: any;
  token?: string | null;
  onAuthFailure?: () => void;
  onLogoUpdate?: (logo: string) => void;
}

export const CompanyKnowledge: React.FC<CompanyKnowledgeProps> = ({ activeWorkspaceId, workspace, token, onAuthFailure, onLogoUpdate }) => {
  const [companyName, setCompanyName] = useState(() => {
    return workspace?.name || localStorage.getItem(`sanford-company-name-${activeWorkspaceId}`) || 'MM Sanford';
  });
  const [description, setDescription] = useState(() => {
    return workspace?.description || localStorage.getItem(`sanford-company-desc-${activeWorkspaceId}`) || "I provide technical marketing solutions for government agencies, higher education institutions, and B2B businesses. My core services are organic search (SEO) for visibility through deep content and technical optimizations, digital advertising with precision targeting and retargeting campaigns, and conversion rate optimization to boost engagement and qualified leads. I'm known for handling complex, large-scale websites and delivering creative, actionable strategies backed by strong analytics expertise—";
  });
  const [targetCustomers, setTargetCustomers] = useState(() => {
    return workspace?.target_audience || localStorage.getItem(`sanford-company-target-${activeWorkspaceId}`) || "Government agencies (state and federal), colleges and universities, and B2B organizations with large, complex web presences. My key contacts are executive directors, marketing managers, and decision-makers needing advanced analytics or strategic marketing.";
  });

  const handleSave = () => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-company-name-${activeWorkspaceId}`, companyName);
      localStorage.setItem(`sanford-company-desc-${activeWorkspaceId}`, description);
      localStorage.setItem(`sanford-company-target-${activeWorkspaceId}`, targetCustomers);
      
      apiFetch(`/api/workspaces/${activeWorkspaceId}`, {
        method: 'PATCH',
        token: token || undefined,
        onAuthFailure,
        body: JSON.stringify({ 
          name: companyName,
          description: description,
          target_audience: targetCustomers
        })
      }).then(() => {
        toast.success('Knowledge base updated successfully!');
      }).catch(err => toast.error('Failed to save to cloud. Please try again.'));
    }
  };

  const [documents, setDocuments] = useState<any[]>([]);
  const [isEditingDoc, setIsEditingDoc] = useState<string | null>(null);
  const [docDraft, setDocDraft] = useState({ title: '', content: '' });

  React.useEffect(() => {
    if (activeWorkspaceId && token) {
      apiFetch(`/api/workspaces/${activeWorkspaceId}/knowledge`, { token })
        .then(setDocuments)
        .catch(console.error);
    }
  }, [activeWorkspaceId, token]);

  const handleCreateDoc = () => {
    setIsEditingDoc('new');
    setDocDraft({ title: '', content: '' });
  };

  const handleSaveDoc = async () => {
    if (!docDraft.title || !docDraft.content) return;
    if (isEditingDoc === 'new') {
      try {
        const newDoc = await apiFetch(`/api/workspaces/${activeWorkspaceId}/knowledge`, {
          method: 'POST',
          token,
          body: JSON.stringify(docDraft)
        });
        setDocuments([newDoc, ...documents]);
        setIsEditingDoc(null);
      } catch (err) { toast.error('Failed to create document'); }
    } else {
      try {
        await apiFetch(`/api/workspaces/${activeWorkspaceId}/knowledge/${isEditingDoc}`, {
          method: 'PATCH',
          token,
          body: JSON.stringify(docDraft)
        });
        setDocuments(documents.map(d => d.id === isEditingDoc ? { ...d, ...docDraft } : d));
        setIsEditingDoc(null);
      } catch (err) { toast.error('Failed to update document'); }
    }
  };

  const [docToDelete, setDocToDelete] = useState<string | null>(null);

  const handleDeleteDocConfirm = async (docId: string) => {
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/knowledge/${docId}`, {
        method: 'DELETE',
        token
      });
      setDocuments(documents.filter(d => d.id !== docId));
    } catch (err) { toast.error('Failed to delete document'); }
  };

  const handleDeleteDoc = async (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDocToDelete(docId);
  };

  const [isEditingName, setIsEditingName] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoClick = () => {
    logoInputRef.current?.click();
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeWorkspaceId) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        apiFetch(`/api/workspaces/${activeWorkspaceId}`, {
          method: 'PATCH',
          token: token || undefined,
          onAuthFailure,
          body: JSON.stringify({ logo: base64String })
        }).then(() => {
          if (onLogoUpdate) onLogoUpdate(base64String);
        }).catch(err => toast.error("Failed to save logo. Please try again."));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50/30 overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-8 py-4 md:py-6 bg-white border-b border-slate-100 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Knowledge</h1>
          <p className="text-xs md:text-sm text-slate-500 mt-1 hidden sm:block">
            General information about your business that all agents use.
          </p>
        </div>
        <button 
          onClick={handleSave}
          className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 flex items-center gap-2 flex-shrink-0"
        >
          <Save className="w-4 h-4" />
          <span className="hidden sm:inline">Save Changes</span>
          <span className="sm:hidden">Save</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-3xl mx-auto space-y-6 md:space-y-8">
          
          {/* Profile Section */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative group">
              <input 
                type="file" 
                ref={logoInputRef} 
                className="hidden" 
                onChange={handleLogoChange}
                accept="image/*"
              />
              <div className="w-24 h-24 md:w-32 md:h-32 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center p-4 md:p-6 overflow-hidden">
                <img 
                  src={workspace?.logo || "https://ais-pre-ozn6jhe7zcj3cdiobiz65k-153562024476.us-west2.run.app/logo.png"} 
                  alt="Company Logo" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <button 
                onClick={handleLogoClick}
                className="absolute -bottom-2 -right-2 p-2 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
              >
                <Edit2 className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="flex items-center gap-2 group">
              {isEditingName ? (
                <input 
                  autoFocus
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                  className="text-xl md:text-2xl font-bold text-slate-900 bg-transparent border-b-2 border-brand-500 outline-none text-center"
                />
              ) : (
                <>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900">{companyName}</h2>
                  <button 
                    onClick={() => setIsEditingName(true)}
                    className="p-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Form Sections */}
          <div className="space-y-4 md:space-y-6">
            {/* Company Description */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-slate-200 rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-4 md:mb-6">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Company Description</h3>
                  <p className="text-[10px] md:text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Help your AI understand and represent your business accurately</p>
                </div>
              </div>
              <textarea 
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full h-48 p-4 md:p-6 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl text-sm md:text-[15px] text-slate-700 leading-relaxed focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500 outline-none transition-all resize-none"
                placeholder="Describe what your company does..."
              />
            </motion.div>

            {/* Target Customers */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white border border-slate-200 rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-4 md:mb-6">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Target Customers</h3>
                  <p className="text-[10px] md:text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Describe your ideal customers and target audience</p>
                </div>
              </div>
              <textarea 
                value={targetCustomers}
                onChange={(e) => setTargetCustomers(e.target.value)}
                className="w-full h-32 p-4 md:p-6 bg-slate-50 border border-slate-100 rounded-xl md:rounded-2xl text-sm md:text-[15px] text-slate-700 leading-relaxed focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500 outline-none transition-all resize-none"
                placeholder="Who are your customers?"
              />
            </motion.div>

            {/* Business Playbooks */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-white border border-slate-200 rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-sm flex flex-col"
            >
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Global Playbooks & Guidelines</h3>
                    <p className="text-[10px] md:text-xs text-slate-400 font-medium uppercase tracking-wider mt-0.5">Embed Markdown rulebooks natively into all Agents</p>
                  </div>
                </div>
                {!isEditingDoc && (
                  <button onClick={handleCreateDoc} className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-brand-50 hover:bg-brand-100 text-brand-600 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-colors">
                    <Plus className="w-4 h-4" />
                    <span className="hidden md:inline">New Playbook</span>
                    <span className="md:hidden">New</span>
                  </button>
                )}
              </div>

              {isEditingDoc ? (
                <div className="bg-slate-50 border border-slate-200 p-4 md:p-6 rounded-2xl">
                  <input
                    type="text"
                    value={docDraft.title}
                    onChange={(e) => setDocDraft({ ...docDraft, title: e.target.value })}
                    placeholder="Document Title (e.g. Brand Voice Guide)"
                    className="w-full bg-white border border-slate-200 p-3 rounded-xl font-bold text-slate-800 mb-4 focus:ring-2 focus:ring-brand-500/20 outline-none"
                  />
                  <textarea
                    value={docDraft.content}
                    onChange={(e) => setDocDraft({ ...docDraft, content: e.target.value })}
                    placeholder="Write or paste your markdown playbook here... Agents will memorize this!"
                    className="w-full h-64 bg-white border border-slate-200 p-4 rounded-xl text-sm text-slate-700 leading-relaxed font-mono focus:ring-2 focus:ring-brand-500/20 outline-none resize-none"
                  />
                  <div className="flex items-center gap-3 mt-4 justify-end">
                    <button onClick={() => setIsEditingDoc(null)} className="px-5 py-2 font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 rounded-xl transition-all">Cancel</button>
                    <button onClick={handleSaveDoc} className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-md transition-all">Save Playbook</button>
                  </div>
                </div>
              ) : documents.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center bg-slate-50/50 border border-slate-100 rounded-2xl border-dashed">
                  <p className="text-sm font-medium text-slate-500">No playbooks created yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Provide SOPs to train your autonomous agents.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {documents.map((doc) => (
                    <div key={doc.id} className="group relative bg-slate-50 hover:bg-white border border-slate-200 hover:border-brand-200 hover:shadow-sm rounded-xl p-4 md:p-5 flex items-center justify-between cursor-pointer transition-all"
                         onClick={() => { setIsEditingDoc(doc.id); setDocDraft({ title: doc.title, content: doc.content }); }}>
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800 text-sm">{doc.title}</h4>
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{doc.content.substring(0, 80)}...</p>
                        </div>
                      </div>
                      <button onClick={(e) => handleDeleteDoc(doc.id, e)} className="p-2 text-slate-300 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Quick Tips */}
            <div className="bg-brand-50/50 border border-brand-100 rounded-2xl p-6 flex gap-4">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-brand-500 flex-shrink-0 shadow-sm">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-brand-900">Pro Tip</h4>
                <p className="text-sm text-brand-700/80 mt-1 leading-relaxed">
                  The more detail you provide here, the better your agents will perform. They use this information to tailor their responses, content, and strategies to your specific business needs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {docToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-xl max-w-sm w-full relative">
            <button onClick={() => setDocToDelete(null)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Delete playbook?</h3>
            <p className="text-slate-500 mt-2 text-sm leading-relaxed">Are you sure you want to delete this playbook? This action cannot be undone and agents will immediately lose access to this knowledge.</p>
            <div className="flex items-center gap-3 mt-8">
              <button onClick={() => setDocToDelete(null)} className="flex-1 px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">Cancel</button>
              <button 
                onClick={() => { handleDeleteDocConfirm(docToDelete); setDocToDelete(null); }} 
                className="flex-1 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md shadow-red-500/20 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
