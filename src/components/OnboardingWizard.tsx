import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, Users, BookOpen, ChevronRight, ChevronLeft, Loader2, Sparkles } from 'lucide-react';
import { apiFetch } from '../services/apiClient';
import toast from 'react-hot-toast';
import { Agent } from '../types';

interface OnboardingWizardProps {
  token: string;
  activeWorkspaceId: number;
  onComplete: () => void;
  onAuthFailure: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ 
  token, 
  activeWorkspaceId, 
  onComplete,
  onAuthFailure
}) => {
  const [step, setStep] = useState<number>(1);
  const [isSaving, setIsSaving] = useState(false);

  // Step 1: Company Info
  const [companyDesc, setCompanyDesc] = useState('');
  const [targetAudience, setTargetAudience] = useState('');

  // AI Scrape feature
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);

  const handleSmartScrape = async () => {
    if (!websiteUrl) {
      toast.error('Please enter a website URL.');
      return;
    }
    setIsScraping(true);
    try {
      const data = await apiFetch(`/api/scrape-onboarding-insights`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({ url: websiteUrl })
      });
      if (data.companyDescription) setCompanyDesc(data.companyDescription);
      if (data.targetAudience) setTargetAudience(data.targetAudience);
      if (data.playbookContent) setPlaybookContent(data.playbookContent);
      toast.success('Fields auto-filled successfully! Please review.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to auto-fill. Please enter manually.');
    } finally {
      setIsScraping(false);
    }
  };

  // Step 2: Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});

  // Step 3: Playbooks
  const [playbookContent, setPlaybookContent] = useState('');

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const data = await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents`, { token, onAuthFailure });
        setAgents(data);
        const initialNames: Record<string, string> = {};
        data.forEach((a: Agent) => initialNames[a.id] = a.name);
        setAgentNames(initialNames);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }
    };
    fetchAgents();
  }, [activeWorkspaceId, token, onAuthFailure]);

  const handleNext = async () => {
    if (step === 1) {
      if (!companyDesc || !targetAudience) {
        toast.error('Please fill out all fields.');
        return;
      }
      setIsSaving(true);
      try {
        await apiFetch(`/api/workspaces/${activeWorkspaceId}`, {
          method: 'PATCH',
          token,
          onAuthFailure,
          body: JSON.stringify({ description: companyDesc, target_audience: targetAudience })
        });
        setStep(2);
      } catch (err) {
        toast.error('Failed to save company information.');
      } finally {
        setIsSaving(false);
      }
    } else if (step === 2) {
      setIsSaving(true);
      try {
        // Save all agent name changes
        await Promise.all(
          agents.map(agent => {
            if (agentNames[agent.id] && agentNames[agent.id] !== agent.name) {
              return apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agent.id)}`, {
                method: 'PATCH',
                token,
                onAuthFailure,
                body: JSON.stringify({ name: agentNames[agent.id] })
              });
            }
            return Promise.resolve();
          })
        );
        setStep(3);
      } catch (err) {
        toast.error('Failed to save agent names.');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleComplete = async () => {
    if (!playbookContent.trim()) {
      toast.error('Please provide at least a brief playbook overview.');
      return;
    }
    
    setIsSaving(true);
    try {
      // 1. Save The Playbook
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/knowledge`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({ title: 'Core Company Playbook', content: playbookContent, author: 'Founder' })
      });

      // 2. Mark workspace as onboarded
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/complete-onboarding`, {
        method: 'POST',
        token,
        onAuthFailure
      });

      toast.success('Setup complete! Welcome to AgencyOS.');
      onComplete();
    } catch (err) {
      toast.error('Failed to finalize onboarding.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-warm-50 overflow-y-auto flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600 shadow-xl mb-6">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-extrabold text-stone-900 tracking-tight">Welcome to AgencyOS</h2>
          <p className="mt-3 text-lg text-stone-500">Let's set up your autonomous workforce in three simple steps.</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-warm-200 rounded-full" />
            <div 
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-brand-600 rounded-full transition-all duration-500"
              style={{ width: `${((step - 1) / 2) * 100}%` }}
            />
            
            {[1, 2, 3].map(i => (
              <div 
                key={i}
                className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-colors duration-300 ${
                  step >= i ? 'bg-brand-600 text-white shadow-md' : 'bg-white text-stone-400 border-2 border-warm-200'
                }`}
              >
                {i === 1 ? <Building2 className="w-4 h-4" /> : i === 2 ? <Users className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-warm-200 overflow-hidden">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-8 sm:p-10"
              >
                <div className="mb-6">
                  <h3 className="text-2xl font-bold text-stone-900">Company Overview</h3>
                  <p className="text-stone-500 mt-2">Before your agents can act, they need to know what your business is all about.</p>
                </div>
                
                <div className="mb-8 p-5 bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-100 rounded-xl relative overflow-hidden">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-bold text-brand-800 mb-1">Auto-Fill from Website (Optional)</label>
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={e => setWebsiteUrl(e.target.value)}
                        placeholder="https://yourcompany.com"
                        className="w-full text-sm py-2.5 px-3 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <button 
                        onClick={handleSmartScrape}
                        disabled={isScraping}
                        className="h-[42px] px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-sm transition-colors flex items-center justify-center disabled:opacity-50"
                      >
                        {isScraping ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        {isScraping ? 'Scanning...' : 'Smart Auto-Fill'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-stone-700 mb-2">What does your company do? (Description)</label>
                    <textarea
                      value={companyDesc}
                      onChange={e => setCompanyDesc(e.target.value)}
                      placeholder="e.g. We are a B2B SaaS platform that helps logistics companies manage their fleets using AI routing."
                      className="w-full text-base py-3 px-4 border border-warm-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 h-32"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-stone-700 mb-2">Who is your target audience?</label>
                    <textarea
                      value={targetAudience}
                      onChange={e => setTargetAudience(e.target.value)}
                      placeholder="e.g. Logistics managers, operations directors at shipping firms."
                      className="w-full text-base py-3 px-4 border border-warm-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 h-24"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-8 sm:p-10"
              >
                <div className="mb-6">
                  <button onClick={() => setStep(1)} className="text-brand-600 hover:text-brand-700 font-medium text-sm flex items-center mb-4"><ChevronLeft className="w-4 h-4 mr-1" /> Back</button>
                  <h3 className="text-2xl font-bold text-stone-900">Name Your Agents</h3>
                  <p className="text-stone-500 mt-2">These are your foundational departments. Give them custom identities or stick with the defaults!</p>
                </div>

                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                  {agents.map(agent => (
                    <div key={agent.id} className="flex items-center gap-4 p-4 border border-warm-200 rounded-xl bg-warm-50">
                      <img src={agent.avatar} alt="" className="w-12 h-12 rounded-lg object-cover" />
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">{agent.role}</label>
                        <input
                          type="text"
                          value={agentNames[agent.id] || ''}
                          onChange={e => setAgentNames(prev => ({...prev, [agent.id]: e.target.value}))}
                          className="w-full font-bold text-stone-900 bg-white px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-8 sm:p-10"
              >
                <div className="mb-6">
                  <button onClick={() => setStep(2)} className="text-brand-600 hover:text-brand-700 font-medium text-sm flex items-center mb-4"><ChevronLeft className="w-4 h-4 mr-1" /> Back</button>
                  <h3 className="text-2xl font-bold text-stone-900">Core Playbook</h3>
                  <p className="text-stone-500 mt-2">This forms the absolute foundational "Knowledge Document" that all agents will reference before acting.</p>
                </div>

                <div>
                  <textarea
                    value={playbookContent}
                    onChange={e => setPlaybookContent(e.target.value)}
                    placeholder="E.g., Our tone is professional yet punchy. We never use exclamation points. We focus obsessively on ROI and metrics when speaking to customers..."
                    className="w-full text-base py-4 px-5 border border-warm-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 h-[40vh]"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="px-8 py-6 bg-warm-50 border-t border-warm-200 flex justify-end">
            {step < 3 ? (
              <button
                onClick={handleNext}
                disabled={isSaving}
                className="inline-flex items-center px-6 py-3 border border-transparent text-base font-bold rounded-xl shadow-sm text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Next Step <ChevronRight className="w-5 h-5 ml-2 -mr-1" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isSaving}
                className="inline-flex items-center px-8 py-3 border border-transparent text-base font-bold rounded-xl shadow-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Complete Setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
