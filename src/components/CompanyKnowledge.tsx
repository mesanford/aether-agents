import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Edit2, Save, Building2, Users, Globe, Info } from 'lucide-react';
import { cn } from '../utils';

interface CompanyKnowledgeProps {
  activeWorkspaceId: number | null;
}

export const CompanyKnowledge: React.FC<CompanyKnowledgeProps> = ({ activeWorkspaceId }) => {
  const [companyName, setCompanyName] = useState(() => {
    const saved = localStorage.getItem(`sanford-company-name-${activeWorkspaceId}`);
    return saved || 'MM Sanford';
  });
  const [description, setDescription] = useState(() => {
    const saved = localStorage.getItem(`sanford-company-desc-${activeWorkspaceId}`);
    return saved || "I provide technical marketing solutions for government agencies, higher education institutions, and B2B businesses. My core services are organic search (SEO) for visibility through deep content and technical optimizations, digital advertising with precision targeting and retargeting campaigns, and conversion rate optimization to boost engagement and qualified leads. I'm known for handling complex, large-scale websites and delivering creative, actionable strategies backed by strong analytics expertise—";
  });
  const [targetCustomers, setTargetCustomers] = useState(() => {
    const saved = localStorage.getItem(`sanford-company-target-${activeWorkspaceId}`);
    return saved || "Government agencies (state and federal), colleges and universities, and B2B organizations with large, complex web presences. My key contacts are executive directors, marketing managers, and decision-makers needing advanced analytics or strategic marketing.";
  });

  const handleSave = () => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-company-name-${activeWorkspaceId}`, companyName);
      localStorage.setItem(`sanford-company-desc-${activeWorkspaceId}`, description);
      localStorage.setItem(`sanford-company-target-${activeWorkspaceId}`, targetCustomers);
      alert('Knowledge base updated successfully!');
    }
  };

  const [isEditingName, setIsEditingName] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoClick = () => {
    logoInputRef.current?.click();
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      alert(`Logo "${file.name}" selected. In a real app, this would be uploaded as your workspace logo.`);
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
                  src="https://ais-pre-ozn6jhe7zcj3cdiobiz65k-153562024476.us-west2.run.app/logo.png" 
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
    </div>
  );
};
