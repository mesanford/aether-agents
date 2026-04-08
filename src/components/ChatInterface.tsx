import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Agent, AgentPersonality, Message, GuidelineSection, GuidelineItem, Lead } from '../types';
import { Send, Settings, MoreHorizontal, Paperclip, ArrowUp, ChevronLeft, ChevronRight, Users, X, Calendar, Mail, Clock, Plus, MessageSquare, Share2, FileText, Download, Eye, Trash2, File, Edit2, Check, Trash, Search, Navigation, ArrowLeft, Activity, BarChart2, ChevronDown, Filter, Phone, Play } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import toast from 'react-hot-toast';
import { buildAgentPromptContext, cn, normalizeAgentPersonality } from '../utils';
import { apiFetch } from '../services/apiClient';

interface ChatInterfaceProps {
  agent: Agent;
  messages: Message[];
  token: string | null;
  activeWorkspaceId: number | null;
  onAuthFailure?: () => void;
  onSendMessage: (content: string) => void;
  isTyping: boolean;
  onUpdateGuidelines: (agentId: string, guidelines: GuidelineSection[]) => Promise<boolean>;
  onUpdateCapabilities: (agentId: string, capabilities: string[]) => Promise<boolean>;
  onUpdatePersonality: (agentId: string, personality: AgentPersonality) => Promise<boolean>;
  onUpdateName?: (agentId: string, name: string) => Promise<boolean>;
  onBack?: () => void;
  onManageAccounts?: () => void;
}

const MAX_AGENT_SKILLS = 25;
const MAX_SKILL_LENGTH = 80;
const ROLE_SKILL_PRESETS: Record<string, string[]> = {
  'Executive Assistant': ['Inbox Triage', 'Calendar Coordination', 'Follow-up Drafting'],
  'Social Media Manager': ['Content Repurposing', 'Campaign Analytics', 'Audience Engagement'],
  'Blog Writer': ['SEO Strategy', 'Long-form Drafting', 'Topic Research'],
  'Sales Associate': ['Lead Qualification', 'Outreach Sequencing', 'CRM Hygiene'],
  'Legal Associate': ['Contract Review', 'Risk Flagging', 'Compliance Checks'],
  'Receptionist': ['Call Routing', 'Inquiry Handling', 'Appointment Intake'],
};

type PromptVersionEntry = {
  id: number;
  userId: number | null;
  before?: {
    description?: string;
    capabilities?: string[];
    guidelines?: GuidelineSection[];
    personality?: AgentPersonality;
  } | null;
  after?: {
    description?: string;
    capabilities?: string[];
    guidelines?: GuidelineSection[];
    personality?: AgentPersonality;
  } | null;
  versionAt?: number | null;
  createdAt?: string | null;
};

type PersonalityDiffItem = {
  label: string;
  before: string;
  after: string;
};

const PERSONALITY_TONE_OPTIONS: Array<AgentPersonality['tone']> = ['warm', 'direct', 'analytical', 'playful', 'formal'];
const PERSONALITY_STYLE_OPTIONS: Array<AgentPersonality['communicationStyle']> = ['concise', 'balanced', 'detailed'];
const PERSONALITY_ASSERTIVENESS_OPTIONS: Array<AgentPersonality['assertiveness']> = ['low', 'medium', 'high'];
const PERSONALITY_HUMOR_OPTIONS: Array<AgentPersonality['humor']> = ['none', 'light'];
const PERSONALITY_VERBOSITY_OPTIONS: Array<AgentPersonality['verbosity']> = ['short', 'medium', 'long'];

function formatPersonalityValue(value: string | string[]) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'none';
  }

  return value.trim().length > 0 ? value : 'none';
}

function buildPersonalityDiff(before?: AgentPersonality | null, after?: AgentPersonality | null): PersonalityDiffItem[] {
  const normalizedBefore = normalizeAgentPersonality(before);
  const normalizedAfter = normalizeAgentPersonality(after);
  const comparisons: Array<{ label: string; before: string | string[]; after: string | string[] }> = [
    { label: 'Tone', before: normalizedBefore.tone, after: normalizedAfter.tone },
    { label: 'Style', before: normalizedBefore.communicationStyle, after: normalizedAfter.communicationStyle },
    { label: 'Assertiveness', before: normalizedBefore.assertiveness, after: normalizedAfter.assertiveness },
    { label: 'Humor', before: normalizedBefore.humor, after: normalizedAfter.humor },
    { label: 'Verbosity', before: normalizedBefore.verbosity, after: normalizedAfter.verbosity },
    { label: 'Signature', before: normalizedBefore.signaturePhrase, after: normalizedAfter.signaturePhrase },
    { label: 'Do Nots', before: normalizedBefore.doNots, after: normalizedAfter.doNots },
  ];

  return comparisons
    .map((comparison) => ({
      label: comparison.label,
      before: formatPersonalityValue(comparison.before),
      after: formatPersonalityValue(comparison.after),
    }))
    .filter((comparison) => comparison.before !== comparison.after);
}

type PersonalityPreset = {
  id: string;
  label: string;
  description: string;
  personality: Partial<AgentPersonality>;
};

const DEFAULT_PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: 'trusted-advisor',
    label: 'Trusted Advisor',
    description: 'Calm and strategic guidance with concise recommendations.',
    personality: {
      tone: 'warm',
      communicationStyle: 'balanced',
      assertiveness: 'medium',
      humor: 'light',
      verbosity: 'medium',
      signaturePhrase: 'Let us lock in the next best move.',
      doNots: ['Do not hedge with vague language', 'Do not overpromise outcomes'],
    },
  },
  {
    id: 'operator',
    label: 'Operator',
    description: 'Decisive execution focus with clear next actions.',
    personality: {
      tone: 'direct',
      communicationStyle: 'concise',
      assertiveness: 'high',
      humor: 'none',
      verbosity: 'short',
      signaturePhrase: 'Next action is ready.',
      doNots: ['Do not add unnecessary context', 'Do not leave decisions unresolved'],
    },
  },
  {
    id: 'deep-analyst',
    label: 'Deep Analyst',
    description: 'Evidence-driven breakdowns with explicit tradeoffs.',
    personality: {
      tone: 'analytical',
      communicationStyle: 'detailed',
      assertiveness: 'medium',
      humor: 'none',
      verbosity: 'long',
      signaturePhrase: 'Here is the reasoning behind the recommendation.',
      doNots: ['Do not skip assumptions', 'Do not hide uncertainty'],
    },
  },
];

const ROLE_PERSONALITY_PRESETS: Record<string, PersonalityPreset[]> = {
  'Executive Assistant': [
    {
      id: 'ea-chief-of-staff',
      label: 'Chief of Staff',
      description: 'Proactive planner with polished executive tone.',
      personality: {
        tone: 'formal',
        communicationStyle: 'concise',
        assertiveness: 'high',
        humor: 'none',
        verbosity: 'short',
        signaturePhrase: 'Prepared and queued for your approval.',
        doNots: ['Do not miss priorities', 'Do not bury the headline'],
      },
    },
    {
      id: 'ea-concierge',
      label: 'Concierge',
      description: 'Warm, service-oriented support with clear options.',
      personality: {
        tone: 'warm',
        communicationStyle: 'balanced',
        assertiveness: 'medium',
        humor: 'light',
        verbosity: 'medium',
        signaturePhrase: 'I have this coordinated for you.',
        doNots: ['Do not sound robotic', 'Do not overload with detail'],
      },
    },
  ],
  'Sales Associate': [
    {
      id: 'sales-closer',
      label: 'Closer',
      description: 'Outcome-driven messaging with strong CTA language.',
      personality: {
        tone: 'direct',
        communicationStyle: 'concise',
        assertiveness: 'high',
        humor: 'light',
        verbosity: 'short',
        signaturePhrase: 'Ready to move this forward?',
        doNots: ['Do not use passive asks', 'Do not bury call-to-action'],
      },
    },
    {
      id: 'sales-consultant',
      label: 'Consultant',
      description: 'Advisory tone that clarifies value and tradeoffs.',
      personality: {
        tone: 'warm',
        communicationStyle: 'balanced',
        assertiveness: 'medium',
        humor: 'none',
        verbosity: 'medium',
        signaturePhrase: 'Let us align this to your business priority.',
        doNots: ['Do not oversell', 'Do not skip discovery questions'],
      },
    },
  ],
  'Legal Associate': [
    {
      id: 'legal-risk-counsel',
      label: 'Risk Counsel',
      description: 'Formal and precise with strong risk framing.',
      personality: {
        tone: 'formal',
        communicationStyle: 'detailed',
        assertiveness: 'high',
        humor: 'none',
        verbosity: 'long',
        signaturePhrase: 'Risk posture and mitigation are outlined below.',
        doNots: ['Do not give absolute legal certainty', 'Do not omit caveats'],
      },
    },
    {
      id: 'legal-plain-english',
      label: 'Plain-English Counsel',
      description: 'Clear legal interpretation for non-legal stakeholders.',
      personality: {
        tone: 'analytical',
        communicationStyle: 'balanced',
        assertiveness: 'medium',
        humor: 'none',
        verbosity: 'medium',
        signaturePhrase: 'In plain terms, here is what this means.',
        doNots: ['Do not use unexplained jargon', 'Do not skip key obligations'],
      },
    },
  ],
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  agent, 
  messages, 
  token,
  activeWorkspaceId,
  onAuthFailure,
  onSendMessage, 
  isTyping, 
  onUpdateGuidelines,
  onUpdateCapabilities,
  onUpdatePersonality,
  onUpdateName,
  onBack,
  onManageAccounts
}) => {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState('Chat');
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [isEditingName, setIsEditingName] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [editingTaskScheduleId, setEditingTaskScheduleId] = useState<string | null>(null);
  const [taskScheduleForm, setTaskScheduleForm] = useState<{repeat: string; dueDate: string}>({repeat: '', dueDate: ''});
  const [isUpdatingTask, setIsUpdatingTask] = useState(false);
  const [guidelineState, setGuidelineState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [promptVersions, setPromptVersions] = useState<PromptVersionEntry[]>([]);
  const [promptVersionState, setPromptVersionState] = useState<{ status: 'idle' | 'loading' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [personalityDraft, setPersonalityDraft] = useState<AgentPersonality>(() => normalizeAgentPersonality(agent.personality));
  const [personalityState, setPersonalityState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'Blog Posts' || activeTab === 'Newsletters' || activeTab === 'Posts' || activeTab === 'Chat') {
      fetchTasks();
    }
  }, [activeTab, activeWorkspaceId, messages.length]);

  const fetchTasks = async () => {
    if (!activeWorkspaceId) return;
    try {
      const data = await apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks`, {
        token: token || undefined,
        onAuthFailure: () => onAuthFailure?.()
      });
      setTasks(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteDraft = async (taskId: string) => {
    if (!taskId || !activeWorkspaceId) return;
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks/${taskId}`, {
        method: 'DELETE',
        token: token || undefined,
        onAuthFailure: () => onAuthFailure?.()
      });
      toast.success('Draft deleted successfully');
      setSelectedBlogPost(null);
      fetchTasks();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete draft');
    }
  };

  useEffect(() => {
    setActiveTab('Chat');
    setGuidelineState({ status: 'idle', message: '' });
    setSkillState({ status: 'idle', message: '' });
    setPersonalityState({ status: 'idle', message: '' });
    setPersonalityDraft(normalizeAgentPersonality(agent.personality));
    setNewCapability('');
    setNameDraft(agent.name);
    setIsEditingName(false);
  }, [agent.id, agent.name, agent.personality]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, activeTab]);

  useEffect(() => {
    if (activeTab !== 'Guidelines' || !token || !activeWorkspaceId || !agent.id) {
      return;
    }

    setPromptVersionState({ status: 'loading', message: '' });
    apiFetch<PromptVersionEntry[]>(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agent.id)}/prompt-versions?limit=8`, {
      token,
      onAuthFailure: () => onAuthFailure?.(),
    })
      .then((data) => {
        setPromptVersions(Array.isArray(data) ? data : []);
        setPromptVersionState({ status: 'idle', message: '' });
      })
      .catch((error) => {
        console.error('Failed to fetch prompt versions', error);
        setPromptVersions([]);
        setPromptVersionState({ status: 'error', message: 'Could not load prompt history.' });
      });
  }, [activeTab, token, activeWorkspaceId, agent.id, onAuthFailure]);

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newCapability, setNewCapability] = useState('');
  const [skillState, setSkillState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveTaskSchedule = async (taskId: string) => {
    try {
      setIsUpdatingTask(true);
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks/${taskId}`, {
        method: 'PATCH',
        token: token || undefined,
        onAuthFailure: () => onAuthFailure?.(),
        body: JSON.stringify({
          repeat: taskScheduleForm.repeat,
          dueDate: taskScheduleForm.dueDate,
        }),
      });
      setTasks(tasks.map(t => t.id === taskId ? { ...t, ...taskScheduleForm } : t));
      setEditingTaskScheduleId(null);
    } catch (err) {
      console.error('Failed to update task schedule:', err);
    } finally {
      setIsUpdatingTask(false);
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeWorkspaceId && token) {
      setIsUploadingAttachment(true);
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Url = reader.result as string;
          const result = await apiFetch(`/api/workspaces/${activeWorkspaceId}/media`, {
            method: 'POST',
            token,
            onAuthFailure,
            body: JSON.stringify({
              name: file.name,
              type: file.type.startsWith('image/') ? 'image' : 'file',
              category: 'uploads',
              thumbnail: base64Url,
              size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            }),
          });
          setPendingAttachment(result.thumbnail);
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error(err);
      } finally {
        setIsUploadingAttachment(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() || pendingAttachment) {
      let finalContent = input.trim();
      if (pendingAttachment) {
         finalContent += finalContent ? `\n\n[Attached image: ${pendingAttachment}]` : `[Attached image: ${pendingAttachment}]`;
      }
      onSendMessage(finalContent);
      setInput('');
      setPendingAttachment(null);
    }
  };

  const suggestions = agent.id === 'social-media-manager' 
    ? [
        "Create an IG post with a futuristic SEO image",
        "Generate a LinkedIn banner for technical consulting",
        "Convert this youtube video into 3 posts"
      ]
    : agent.id === 'blog-writer'
    ? [
        "Write a blog post and generate a hero image for it",
        "Create a technical diagram for SEO intent clustering",
        "Draft a weekly agency trends email"
      ]
    : [
        "List all my ongoing campaigns",
        "What's on my schedule for today?",
        "Help me with lead generation"
      ];

  const renderGuidelines = () => {
    const trimmedCapability = newCapability.trim();
    const normalizedCapabilities = agent.capabilities.map((capability) => capability.toLowerCase());
    const hasDuplicateCapability = trimmedCapability.length > 0 && normalizedCapabilities.includes(trimmedCapability.toLowerCase());
    const exceedsSkillLength = trimmedCapability.length > MAX_SKILL_LENGTH;
    const hasSkillCapacity = agent.capabilities.length < MAX_AGENT_SKILLS;
    const canAddSkill = trimmedCapability.length > 0 && !hasDuplicateCapability && !exceedsSkillLength && hasSkillCapacity;
    const effectivePromptPreview = buildAgentPromptContext({
      description: agent.description,
      capabilities: agent.capabilities,
      guidelines: agent.guidelines,
      personality: personalityDraft,
    });
    const savedPersonality = normalizeAgentPersonality(agent.personality);
    const hasUnsavedPersonalityChanges = JSON.stringify(savedPersonality) !== JSON.stringify(personalityDraft);
    const personalityPresets = ROLE_PERSONALITY_PRESETS[agent.role] || DEFAULT_PERSONALITY_PRESETS;
    const rolePresetSkills = ROLE_SKILL_PRESETS[agent.role] || [];
    const missingRolePresetSkills = rolePresetSkills.filter((skill) => !normalizedCapabilities.includes(skill.toLowerCase()));

    const persistGuidelinesUpdate = async (nextGuidelines: GuidelineSection[], successMessage: string) => {
      setGuidelineState({ status: 'saving', message: '' });
      const success = await onUpdateGuidelines(agent.id, nextGuidelines);
      setGuidelineState(success
        ? { status: 'success', message: successMessage }
        : { status: 'error', message: 'Failed to save guideline changes.' });
    };

    const applyRoleSkillPreset = async () => {
      if (missingRolePresetSkills.length === 0 || skillState.status === 'saving') {
        return;
      }

      const filteredPresetSkills = missingRolePresetSkills
        .filter((skill) => skill.length <= MAX_SKILL_LENGTH)
        .slice(0, Math.max(0, MAX_AGENT_SKILLS - agent.capabilities.length));

      if (filteredPresetSkills.length === 0) {
        setSkillState({ status: 'error', message: 'No preset skills can be applied due to current limits.' });
        return;
      }

      setSkillState({ status: 'saving', message: '' });
      const success = await onUpdateCapabilities(agent.id, [...agent.capabilities, ...filteredPresetSkills]);
      setSkillState(success
        ? { status: 'success', message: `Applied ${filteredPresetSkills.length} preset skill${filteredPresetSkills.length > 1 ? 's' : ''}.` }
        : { status: 'error', message: 'Failed to apply skill presets.' });
    };

    const handleUpdateSectionTitle = (sectionId: string, newTitle: string) => {
      const updated = agent.guidelines.map(s => 
        s.id === sectionId ? { ...s, title: newTitle } : s
      );
      void persistGuidelinesUpdate(updated, 'Section title updated.');
      setEditingSectionId(null);
    };

    const handleUpdateItemContent = (sectionId: string, itemId: string, newContent: string) => {
      const updated = agent.guidelines.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            items: s.items.map(i => i.id === itemId ? { ...i, content: newContent } : i)
          };
        }
        return s;
      });
      void persistGuidelinesUpdate(updated, 'Guideline updated.');
      setEditingItemId(null);
    };

    const handleDeleteItem = (sectionId: string, itemId: string) => {
      const updated = agent.guidelines.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            items: s.items.filter(i => i.id !== itemId)
          };
        }
        return s;
      });
      void persistGuidelinesUpdate(updated, 'Guideline removed.');
    };

    const handleDeleteSection = (sectionId: string) => {
      const updated = agent.guidelines.filter(s => s.id !== sectionId);
      void persistGuidelinesUpdate(updated, 'Section removed.');
    };

    const handleAddItem = (sectionId: string, content: string) => {
      if (!content.trim()) return;
      const updated = agent.guidelines.map(s => {
        if (s.id === sectionId) {
          return {
            ...s,
            items: [...s.items, { id: Date.now().toString(), content, isMarkdown: true }]
          };
        }
        return s;
      });
      void persistGuidelinesUpdate(updated, 'Guideline added.');
    };

    const handleAddSection = () => {
      if (!newSectionTitle.trim()) return;
      const newSection: GuidelineSection = {
        id: Date.now().toString(),
        title: newSectionTitle,
        items: [],
        showInput: true
      };
      void persistGuidelinesUpdate([...agent.guidelines, newSection], 'Section added.');
      setNewSectionTitle('');
    };

    const handleAddCapability = async () => {
      if (!canAddSkill) return;

      setSkillState({ status: 'saving', message: '' });
      const success = await onUpdateCapabilities(agent.id, [...agent.capabilities, trimmedCapability]);
      setSkillState(success
        ? { status: 'success', message: 'Skill saved.' }
        : { status: 'error', message: 'Failed to save skill.' });
      setNewCapability('');
    };

    const handleRemoveCapability = async (capabilityToRemove: string) => {
      setSkillState({ status: 'saving', message: '' });
      const success = await onUpdateCapabilities(agent.id, agent.capabilities.filter((capability) => capability !== capabilityToRemove));
      setSkillState(success
        ? { status: 'success', message: 'Skill removed.' }
        : { status: 'error', message: 'Failed to remove skill.' });
    };

    const updateDoNotList = (rawValue: string) => {
      const nextValues = rawValue
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, 5);
      setPersonalityDraft((current) => ({ ...current, doNots: nextValues }));
    };

    const savePersonality = async () => {
      setPersonalityState({ status: 'saving', message: '' });
      const success = await onUpdatePersonality(agent.id, personalityDraft);
      setPersonalityState(success
        ? { status: 'success', message: 'Personality profile saved.' }
        : { status: 'error', message: 'Could not save personality. Keep profiles distinct and try again.' });
    };

    const revertPersonalityDraft = () => {
      setPersonalityDraft(savedPersonality);
      setPersonalityState({ status: 'idle', message: '' });
    };

    const applyPersonalityPreset = async (preset: PersonalityPreset) => {
      if (personalityState.status === 'saving') {
        return;
      }

      const nextPersonality = normalizeAgentPersonality({
        ...personalityDraft,
        ...preset.personality,
      });
      setPersonalityDraft(nextPersonality);

      setPersonalityState({ status: 'saving', message: '' });
      const success = await onUpdatePersonality(agent.id, nextPersonality);
      setPersonalityState(success
        ? { status: 'success', message: `Applied ${preset.label} preset.` }
        : { status: 'error', message: 'Could not apply preset. Keep profiles distinct and try again.' });
    };

    const handleNameSave = async () => {
      if (nameDraft.trim() && nameDraft !== agent.name && onUpdateName) {
        const success = await onUpdateName(agent.id, nameDraft.trim());
        if (success) setIsEditingName(false);
      } else {
        setIsEditingName(false);
        setNameDraft(agent.name);
      }
    };

    return (
      <div className="flex-1 overflow-y-auto p-12 bg-white">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-4xl font-bold text-slate-900">Guidelines</h1>
          </div>
          
          <div className="flex items-center gap-2 mb-10">
            <span className="text-slate-500">Agent Details:</span>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input 
                  autoFocus
                  className="border border-slate-200 rounded px-2 py-1 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-brand-500/20"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { 
                    if (e.key === 'Enter') void handleNameSave(); 
                    if (e.key === 'Escape') { setIsEditingName(false); setNameDraft(agent.name); } 
                  }}
                />
                <button onClick={() => void handleNameSave()} className="text-emerald-600 hover:text-emerald-700 bg-emerald-50 p-1 rounded"><Check className="w-4 h-4" /></button>
                <button onClick={() => { setIsEditingName(false); setNameDraft(agent.name); }} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-1 rounded"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group py-1">
                <span className="font-semibold text-slate-700">{agent.name}</span>
                <span className="text-xs font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{agent.role}</span>
                <button onClick={() => setIsEditingName(true)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500 transition-opacity ml-1">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          
          {guidelineState.message ? (
            <p className={cn(
              'text-xs mb-6 font-medium',
              guidelineState.status === 'error' ? 'text-rose-600' : 'text-emerald-600',
            )}>
              {guidelineState.message}
            </p>
          ) : null}

          <section className="mb-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Personality Profile</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={revertPersonalityDraft}
                  disabled={!hasUnsavedPersonalityChanges || personalityState.status === 'saving'}
                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  Revert Draft
                </button>
                <button
                  type="button"
                  onClick={() => void savePersonality()}
                  disabled={personalityState.status === 'saving' || !hasUnsavedPersonalityChanges}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {personalityState.status === 'saving' ? 'Saving...' : 'Save Personality'}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-3">Define voice traits that make this agent behavior distinct from others.</p>
            <div className="mb-3 rounded-xl border border-slate-200 bg-white p-2.5">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Quick Presets</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {personalityPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void applyPersonalityPreset(preset)}
                    disabled={personalityState.status === 'saving'}
                    className="text-left rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50 transition-all disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <p className="text-xs font-bold text-slate-800">{preset.label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{preset.description}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Tone
                <select
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.tone}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, tone: event.target.value as AgentPersonality['tone'] }))}
                >
                  {PERSONALITY_TONE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Communication Style
                <select
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.communicationStyle}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, communicationStyle: event.target.value as AgentPersonality['communicationStyle'] }))}
                >
                  {PERSONALITY_STYLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Assertiveness
                <select
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.assertiveness}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, assertiveness: event.target.value as AgentPersonality['assertiveness'] }))}
                >
                  {PERSONALITY_ASSERTIVENESS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Humor
                <select
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.humor}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, humor: event.target.value as AgentPersonality['humor'] }))}
                >
                  {PERSONALITY_HUMOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Verbosity
                <select
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.verbosity}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, verbosity: event.target.value as AgentPersonality['verbosity'] }))}
                >
                  {PERSONALITY_VERBOSITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 flex flex-col gap-1">
                Signature Phrase
                <input
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                  value={personalityDraft.signaturePhrase}
                  onChange={(event) => setPersonalityDraft((current) => ({ ...current, signaturePhrase: event.target.value.slice(0, 120) }))}
                  placeholder="Optional signature line"
                />
              </label>
            </div>
            <label className="text-xs text-slate-600 flex flex-col gap-1">
              Do Nots (comma-separated, up to 5)
              <input
                className="bg-white border border-slate-200 rounded-lg px-2 py-1.5"
                value={personalityDraft.doNots.join(', ')}
                onChange={(event) => updateDoNotList(event.target.value)}
                placeholder="Do not use filler phrases, Do not overpromise"
              />
            </label>
            {personalityState.message ? (
              <p className={cn(
                'text-xs mt-3 font-medium',
                personalityState.status === 'error' ? 'text-rose-600' : 'text-emerald-600',
              )}>
                {personalityState.message}
              </p>
            ) : null}
          </section>

          <section className="mb-12">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Skills</h2>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">{agent.capabilities.length} / {MAX_AGENT_SKILLS} skills</p>
              <p className="text-xs text-slate-500">{trimmedCapability.length} / {MAX_SKILL_LENGTH} chars</p>
            </div>
            {rolePresetSkills.length > 0 ? (
              <div className="flex items-center justify-between mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-600">Role presets: {rolePresetSkills.join(', ')}</p>
                <button
                  type="button"
                  onClick={() => void applyRoleSkillPreset()}
                  disabled={missingRolePresetSkills.length === 0 || skillState.status === 'saving' || !hasSkillCapacity}
                  className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  Apply Preset
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 mb-4">
              {agent.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold border border-brand-100"
                >
                  {capability}
                  <button
                    type="button"
                    onClick={() => void handleRemoveCapability(capability)}
                    className="text-brand-500 hover:text-brand-700"
                    aria-label={`Remove ${capability}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {agent.capabilities.length === 0 ? (
                <p className="text-sm text-slate-500">No skills configured yet.</p>
              ) : null}
            </div>
            <div className="flex gap-3">
              <input
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                placeholder="Add a skill, e.g. SEO Strategy"
                value={newCapability}
                onChange={(event) => setNewCapability(event.target.value)}
                disabled={!hasSkillCapacity || skillState.status === 'saving'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleAddCapability();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void handleAddCapability()}
                disabled={!canAddSkill || skillState.status === 'saving'}
                className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {skillState.status === 'saving' ? 'Saving...' : 'Add Skill'}
              </button>
            </div>
            {!hasSkillCapacity ? (
              <p className="text-xs text-amber-600 mt-2">Maximum skills reached. Remove one before adding another.</p>
            ) : null}
            {hasDuplicateCapability ? (
              <p className="text-xs text-amber-600 mt-2">This skill already exists for the agent.</p>
            ) : null}
            {exceedsSkillLength ? (
              <p className="text-xs text-rose-600 mt-2">Keep each skill under {MAX_SKILL_LENGTH} characters.</p>
            ) : null}
            {skillState.message ? (
              <p className={cn(
                'text-xs mt-2 font-medium',
                skillState.status === 'error' ? 'text-rose-600' : 'text-emerald-600',
              )}>
                {skillState.message}
              </p>
            ) : null}
          </section>

          <section className="mb-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Effective Prompt Context</h2>
            <p className="text-xs text-slate-500 mb-3">This is the agent profile context sent with each AI response request.</p>
            <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-xl p-3 max-h-56 overflow-y-auto">{effectivePromptPreview}</pre>
          </section>

          <section className="mb-12 rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Prompt History</h2>
            <p className="text-xs text-slate-500 mb-3">Recent prompt profile versions captured from agent settings updates.</p>
            {promptVersionState.status === 'loading' ? (
              <p className="text-xs text-slate-500">Loading prompt history...</p>
            ) : null}
            {promptVersionState.status === 'error' ? (
              <p className="text-xs text-rose-600">{promptVersionState.message}</p>
            ) : null}
            {promptVersionState.status !== 'loading' && promptVersions.length === 0 ? (
              <p className="text-xs text-slate-500">No prompt versions recorded yet.</p>
            ) : null}
            {promptVersions.length > 0 ? (
              <div className="space-y-2">
                {promptVersions.map((entry) => {
                  const createdLabel = entry.createdAt || (entry.versionAt ? new Date(entry.versionAt).toISOString() : 'Unknown time');
                  const beforeCaps = Array.isArray(entry.before?.capabilities) ? entry.before?.capabilities?.length || 0 : 0;
                  const afterCaps = Array.isArray(entry.after?.capabilities) ? entry.after?.capabilities?.length || 0 : 0;
                  const beforeGuidelines = Array.isArray(entry.before?.guidelines) ? entry.before?.guidelines?.length || 0 : 0;
                  const afterGuidelines = Array.isArray(entry.after?.guidelines) ? entry.after?.guidelines?.length || 0 : 0;
                  const personalityDiff = buildPersonalityDiff(entry.before?.personality, entry.after?.personality);

                  return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700">Version #{entry.id} • {createdLabel}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        Skills: {beforeCaps} → {afterCaps} · Sections: {beforeGuidelines} → {afterGuidelines}
                      </p>
                      {personalityDiff.length > 0 ? (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Personality Delta</p>
                          <div className="space-y-1.5">
                            {personalityDiff.map((change) => (
                              <div key={change.label} className="grid grid-cols-[80px_1fr_auto_1fr] gap-2 text-xs items-start">
                                <span className="font-semibold text-slate-500">{change.label}</span>
                                <span className="text-slate-500 break-words">{change.before}</span>
                                <span className="text-slate-300">→</span>
                                <span className="text-slate-800 break-words">{change.after}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 mt-2">No personality field changes recorded for this version.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <div className="space-y-12">
            {agent.guidelines.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-10 h-10 text-slate-200" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">No guidelines yet</h3>
                <p className="text-sm text-slate-500 max-w-xs mt-2">Add your first section below to give {agent.name} custom instructions to follow.</p>
              </div>
            )}
            {agent.guidelines.map((section) => (
              <section key={section.id} className="group/section relative">
                <div className="flex items-center gap-4 mb-6">
                  {editingSectionId === section.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input 
                        autoFocus
                        className="flex-1 font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-brand-500/20"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdateSectionTitle(section.id, editValue)}
                      />
                      <button onClick={() => handleUpdateSectionTitle(section.id, editValue)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingSectionId(null)} className="p-1 text-slate-400 hover:bg-slate-50 rounded">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h3 className="font-bold text-slate-900">{section.title}</h3>
                      <div className="flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingSectionId(section.id);
                            setEditValue(section.title);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteSection(section.id)}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-4">
                  {section.items.map((item, idx) => (
                    <div key={item.id} className="group relative flex gap-4 p-6 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-slate-200 transition-all">
                      <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-sm flex-shrink-0">{idx + 1}</div>
                      <div className="flex-1 text-slate-600 text-[15px] leading-relaxed whitespace-pre-wrap">
                        {editingItemId === item.id ? (
                          <div className="flex flex-col gap-2">
                            <textarea 
                              autoFocus
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 outline-none focus:ring-2 focus:ring-brand-500/20 min-h-[100px]"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                            />
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setEditingItemId(null)} className="px-3 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-lg">Cancel</button>
                              <button onClick={() => handleUpdateItemContent(section.id, item.id, editValue)} className="px-3 py-1 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700">Save</button>
                            </div>
                          </div>
                        ) : (
                          item.isMarkdown ? (
                            <div className="markdown-body">
                              <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
                            </div>
                          ) : (
                            item.content
                          )
                        )}
                      </div>
                      {!editingItemId && (
                        <div className="opacity-0 group-hover:opacity-100 absolute top-4 right-4 flex gap-1">
                          <button 
                            onClick={() => {
                              setEditingItemId(item.id);
                              setEditValue(item.content);
                            }}
                            className="p-1.5 text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteItem(section.id, item.id)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <div className="flex gap-4 p-6 bg-white border border-slate-100 rounded-xl border-dashed group/new-item">
                    <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center font-bold text-sm flex-shrink-0">{section.items.length + 1}</div>
                    <input 
                      className="flex-1 bg-transparent border-none p-0 text-[15px] text-slate-600 focus:ring-0 placeholder:text-slate-300" 
                      placeholder="Add a new instruction..." 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddItem(section.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                  </div>
                </div>
              </section>
            ))}

            {/* Add New Section */}
            <div className="pt-8 border-t border-slate-100">
              <div className="flex gap-4">
                <input 
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                  placeholder="New Section Title..."
                  value={newSectionTitle}
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSection()}
                />
                <button 
                  onClick={handleAddSection}
                  className="px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Section
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPosts = () => {
    const socialTasks = tasks.filter(t => t.executionType === 'social_post' && t.status !== 'done');
    const posts = socialTasks.map(t => ({
      id: t.id,
      title: t.title,
      time: t.dueDate || 'DRAFT',
      image: t.artifact?.imageUrl || t.selectedMediaAssetId || null,
      content: t.artifact?.body || t.description || 'Draft pending...'
    }));

    return (
      <div className="flex-1 flex flex-col bg-slate-50/30 min-w-0 overflow-hidden">
        {/* Calendar Header Tool bar */}
        <div className="px-6 py-3 flex items-center justify-between bg-white border-b border-slate-100 flex-shrink-0 z-10 sticky left-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 text-slate-800 font-bold text-[15px]">
              <button className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-5 h-5" /></button>
              Apr 6 - Apr 12
              <button className="text-slate-400 hover:text-slate-600"><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
          <button onClick={onManageAccounts} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
            <Users className="w-4 h-4" />
            Accounts
          </button>
        </div>

        {/* Scrollable multi-column board */}
        <div className="flex-1 overflow-x-auto overflow-y-auto flex bg-white scroll-smooth relative">
          <div className="flex min-w-max px-6 py-6 gap-6 items-start bottom-0">
            
            {/* Drafts Column */}
            <div className="w-[280px] flex flex-col flex-shrink-0 border-r border-slate-100/0 pr-2">
              <div className="text-[13px] font-semibold text-slate-500 mb-5 flex justify-center py-2">{posts.filter(p => !p.time || p.time.toUpperCase() === 'DRAFT' || p.time.toLowerCase() === 'drafting').length} Drafts</div>
              <div className="flex flex-col gap-4">
                {posts.filter(p => !p.time || p.time.toUpperCase() === 'DRAFT' || p.time.toLowerCase() === 'drafting').map(post => (
                  <div 
                    key={post.id}
                    onClick={() => setSelectedBlogPost({ ...post, date: post.time })}
                    className="bg-white border border-slate-200 hover:border-brand-300 rounded-2xl p-4 flex flex-col shadow-sm hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-6 h-6 rounded-full bg-[#0a66c2] text-white flex items-center justify-center font-bold font-serif text-[13px] leading-none tracking-tighter">in</div>
                    </div>
                    <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-3 mb-4">
                      {post.title}
                    </div>
                    {post.image && (
                      <div className="aspect-[4/3] bg-[#f8fafc] rounded-xl overflow-hidden mt-auto p-2 flex items-center justify-center relative">
                        <img src={post.image} className="w-full h-full object-contain mix-blend-multiply" referrerPolicy="no-referrer" />
                        <div className="absolute right-2 top-2 bg-white rounded shadow-sm border border-slate-100 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400">
                          <Edit2 className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Calendar Columns */}
            {[
              { id: 'mon', label: 'Mon 6', isActive: false },
              { id: 'tue', label: 'Tue 7', isActive: false },
              { id: 'wed', label: 'Wed 8', isActive: true },
              { id: 'thu', label: 'Thu 9', isActive: false },
              { id: 'fri', label: 'Fri 10', isActive: false }
            ].map((day, dayIndex, daysArr) => {
               const scheduledPosts = posts.filter(p => p.time && p.time.toUpperCase() !== 'DRAFT' && p.time.toLowerCase() !== 'drafting');
               // For demo UI accuracy, if there are no real scheduled tasks, we will render none. But if there are, distribute them based on their index
               const assignedPosts = scheduledPosts.filter((_, i) => (i % daysArr.length) === dayIndex);

               return (
                <div key={day.id} className="w-[280px] flex flex-col flex-shrink-0 relative">
                  <div className={cn("text-[13.5px] text-center mb-5 py-2.5 rounded-xl transition-colors font-medium", day.isActive ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-500")}>
                    {day.label}
                  </div>
                  <div className="flex flex-col gap-4 relative">
                    {assignedPosts.map(post => (
                      <div 
                        key={post.id}
                        onClick={() => setSelectedBlogPost({ ...post, date: day.label })}
                        className="bg-white border border-slate-200 hover:border-brand-300 rounded-2xl p-4 flex flex-col shadow-sm hover:shadow-md transition-all cursor-pointer group"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="w-6 h-6 rounded-full bg-[#0a66c2] text-white flex items-center justify-center font-bold font-serif text-[13px] leading-none tracking-tighter">in</div>
                          <span className="text-[12px] font-bold text-slate-800">{post.time}</span>
                        </div>
                        <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-3 mb-4">
                          {post.title}
                        </div>
                        {post.image && (
                          <div className="aspect-[4/3] bg-[#f8fafc] rounded-xl overflow-hidden mt-auto p-2 flex items-center justify-center relative">
                            <img src={post.image} className="w-full h-full object-contain mix-blend-multiply" referrerPolicy="no-referrer" />
                            <div className="absolute right-2 top-2 bg-white rounded shadow-sm border border-slate-100 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400">
                              <Edit2 className="w-3.5 h-3.5" />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
               );
            })}
          </div>
        </div>

        {/* Full Preview Modal */}
        <AnimatePresence>
          {selectedBlogPost && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setSelectedBlogPost(null)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="bg-white w-full max-w-lg max-h-[90vh] rounded-3xl shadow-2xl flex flex-col relative overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white z-10 shrink-0">
                  <div className="flex items-center -space-x-1">
                    <div className="w-9 h-9 rounded-full border-[2.5px] border-white bg-[#0a66c2] text-white flex items-center justify-center font-bold relative z-20 shadow-sm">
                      <span className="text-[17px] font-serif leading-none tracking-tighter">in</span>
                      <img src={agent.avatar} className="absolute -bottom-1.5 -right-1.5 w-[18px] h-[18px] rounded-full border-[1.5px] border-white object-cover bg-white" />
                    </div>
                    <div className="w-9 h-9 rounded-full border-[2.5px] border-white bg-blue-500 text-white flex items-center justify-center font-bold relative z-10 shadow-sm">
                      <span className="text-[16px] font-sans">G</span>
                    </div>
                    <button className="w-9 h-9 rounded-full border-[1.5px] border-dashed border-slate-300 bg-white text-slate-400 flex items-center justify-center hover:bg-slate-50 relative z-0 transition-colors ml-1">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <button className="p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 rounded-full transition-colors">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-white pt-4 pb-24 px-6 relative">
                  <div className="flex justify-end mb-4">
                    <span className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 shadow-sm mt-1">Draft</span>
                  </div>

                  <div className="bg-[#fdf8f4] rounded-2xl aspect-square flex items-center justify-center p-6 mb-4 shadow-sm border border-slate-100 relative group overflow-hidden">
                    <button className="absolute left-3 top-3 w-10 h-10 bg-white border border-slate-200 shadow-sm rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:shadow transition-all z-10">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {selectedBlogPost.image ? (
                      <img src={selectedBlogPost.image} className="w-full h-full object-contain mix-blend-multiply" />
                    ) : (
                      <div className="text-slate-400 font-bold text-sm">No Image Selected</div>
                    )}
                  </div>
                  
                  <div className="flex gap-3 justify-center mb-6">
                    {selectedBlogPost.image && (
                      <div className="w-16 h-16 rounded-[14px] border-2 border-blue-500 p-1 relative group cursor-pointer overflow-hidden bg-slate-50">
                        <img src={selectedBlogPost.image} className="w-full h-full object-cover rounded-lg" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg m-1">
                          <Trash className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    )}
                    <button className="w-16 h-16 rounded-[14px] border-[1.5px] border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50 hover:border-slate-400 transition-colors">
                      <Plus className="w-5 h-5 mb-0.5" />
                      <span className="text-[9px] font-bold">Add Media</span>
                    </button>
                  </div>

                  <div className="markdown-body text-[15px] text-slate-800 leading-relaxed px-1">
                    <Markdown remarkPlugins={[remarkGfm]}>{selectedBlogPost.content}</Markdown>
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 w-full bg-white/90 backdrop-blur border-t border-slate-100 p-4 flex items-center justify-between shrink-0">
                  <div className="flex gap-2.5">
                    <button className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13.5px] font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-2 transition-colors">
                      <Calendar className="w-4 h-4" />
                      Schedule
                    </button>
                    <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                      Publish
                    </button>
                  </div>
                  <button onClick={() => setSelectedBlogPost(null)} className="px-6 py-2 bg-black text-white rounded-xl text-[13.5px] font-bold shadow hover:bg-slate-800 transition-colors">
                    Save
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const [selectedBlogPost, setSelectedBlogPost] = useState<any>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<any>(null);
  const [sequences, setSequences] = useState<any[]>([
    {
      id: 1,
      title: "Sanford Consulting — Gov/HE/B2B Tech Marketing (SEO + GA4 + CRO)",
      date: "04 Feb",
      status: "Running",
      schedule: "Runs every day between 10 AM - 11 AM",
      steps: [
        { id: 1, type: "Enroll", title: "Enroll leads", subtitle: "Status: New Lead" },
        { id: 2, type: "Email", title: "Send email", subtitle: "{{lead.company}}: quick GA4/SEO wins for complex sites" },
        { id: 3, type: "Wait", title: "Wait 3 days" },
        { id: 4, type: "Email", title: "Send email", subtitle: "Re: {{lead.company}} GA4 + SEO + conversions" },
        { id: 5, type: "Wait", title: "Wait 2 days" },
        { id: 6, type: "LinkedIn", title: "Send Invitation", subtitle: "Send connection request to leads" }
      ]
    }
  ]);
  const [editingStep, setEditingStep] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [blogViewTab, setBlogViewTab] = useState<'list'|'calendar'>('list');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [sequenceViewTab, setSequenceViewTab] = useState<'editor' | 'progress'>('progress');

  useEffect(() => {
    if (activeTab === 'Leads' && token && activeWorkspaceId) {
      fetchLeads();
    }
  }, [activeTab, token, activeWorkspaceId]);

  const fetchLeads = async () => {
    if (!token || !activeWorkspaceId) return;

    try {
      const data = await apiFetch(`/api/workspaces/${activeWorkspaceId}/leads`, {
        token,
        onAuthFailure: () => onAuthFailure?.(),
      });
      setLeads(data);
    } catch (error) {
      console.error('Error fetching leads:', error);
    }
  };

  const renderLeads = () => {
    const filteredLeads = leads.filter(lead => 
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const toggleLeadSelection = (id: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const newSelected = new Set(selectedLeadIds);
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setSelectedLeadIds(newSelected);
    };

    const toggleAllLeads = () => {
      if (selectedLeadIds.size === filteredLeads.length && filteredLeads.length > 0) {
        setSelectedLeadIds(new Set());
      } else {
        setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
      }
    };

    return (
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* CRM Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 min-h-[72px]">
          {selectedLeadIds.size > 0 ? (
            <div className="flex items-center gap-6 w-full">
               <div className="flex items-center gap-4 flex-1 max-w-sm">
                 <div className="relative flex-1">
                   <input 
                     type="text" 
                     placeholder="Search" 
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13.5px] focus:ring-2 focus:ring-brand-500/20 opacity-50 pointer-events-none"
                   />
                   <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                     <Search className="w-4 h-4" />
                   </div>
                 </div>
                 <span className="text-[13.5px] font-medium text-slate-500 whitespace-nowrap">{selectedLeadIds.size} selected</span>
               </div>
               <div className="flex gap-2">
                 <button className="px-4 py-2 bg-black text-white rounded-lg text-[13.5px] font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow shadow-black/5">
                   <Navigation className="w-[15px] h-[15px] fill-current" /> Manage sequences
                 </button>
                 <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-bold text-slate-700 flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                   <Edit2 className="w-[15px] h-[15px]" /> Edit
                 </button>
                 <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-bold text-slate-700 flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                   <Trash2 className="w-[15px] h-[15px]" /> Delete
                 </button>
               </div>
               <div className="flex-1 flex justify-end">
                 <button className="px-5 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-bold text-slate-700 flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
                   <Download className="w-[15px] h-[15px]" /> Export ({selectedLeadIds.size})
                 </button>
               </div>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-4 flex-1 max-w-sm">
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[13.5px] focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search className="w-[15px] h-[15px]" />
                  </div>
                </div>
                <span className="text-[13.5px] font-medium text-slate-400 whitespace-nowrap">{filteredLeads.length} results</span>
              </div>
              <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm">
                Import Leads
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4 w-12"><input type="checkbox" checked={selectedLeadIds.size > 0 && selectedLeadIds.size === filteredLeads.length} onChange={toggleAllLeads} className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer accent-black" /></th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Profiles</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Email</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sequence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLeads.map((lead) => (
                <tr 
                  key={lead.id} 
                  onClick={() => setSelectedLead(lead)}
                  className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-6 py-4" onClick={(e) => toggleLeadSelection(lead.id, e)}><input type="checkbox" checked={selectedLeadIds.has(lead.id)} readOnly className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer pointer-events-none accent-black" /></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs overflow-hidden">
                        {lead.avatar && lead.avatar.length <= 2 ? lead.avatar : <img src={lead.avatar} className="w-full h-full object-cover" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{lead.name}</div>
                        <div className="text-xs text-slate-500">{lead.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-700">{lead.company}</div>
                    <div className="text-xs text-slate-400">{lead.location}</div>
                  </td>
                  <td className="px-6 py-4">
                    <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700" onClick={e => e.stopPropagation()}>
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
                    </a>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{lead.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", lead.status === 'New Lead' ? "bg-slate-300" : "bg-blue-500")} />
                      <span className="text-sm text-slate-700">{lead.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[11px] font-bold",
                      lead.sequence === 'None' ? "bg-slate-100 text-slate-500" : "bg-blue-50 text-blue-600 border border-blue-100"
                    )}>
                      {lead.sequence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Lead Detail Modal */}
        <AnimatePresence>
          {selectedLead && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setSelectedLead(null)}
            >
              <motion.div 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="bg-white w-full max-w-xl h-full shadow-2xl overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-900">Lead Details</h2>
                  <button onClick={() => setSelectedLead(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8">
                  <div className="flex items-center gap-6 mb-8">
                    <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-2xl overflow-hidden">
                      {selectedLead.avatar && selectedLead.avatar.length <= 2 ? selectedLead.avatar : <img src={selectedLead.avatar} className="w-full h-full object-cover" />}
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-slate-900">{selectedLead.name}</h1>
                      <p className="text-slate-500">{selectedLead.role} at {selectedLead.company}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Email</label>
                        <div className="text-sm text-slate-700">{selectedLead.email}</div>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Location</label>
                        <div className="text-sm text-slate-700">{selectedLead.location || 'Not specified'}</div>
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Status</label>
                        <div className="text-sm text-slate-700">{selectedLead.status}</div>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Sequence</label>
                        <div className="text-sm text-slate-700">{selectedLead.sequence}</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-12">
                    <h3 className="font-bold text-slate-900 mb-4">Notes</h3>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 whitespace-pre-wrap text-sm text-slate-600 leading-relaxed">
                      {selectedLead.notes?.trim() || 'No saved notes for this lead yet.'}
                    </div>
                  </div>

                  <div className="mt-12">
                    <h3 className="font-bold text-slate-900 mb-4">Activity Timeline</h3>
                    <div className="space-y-6">
                      <div className="relative pl-6 border-l-2 border-slate-100">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-blue-500 border-4 border-white shadow-sm" />
                        <div className="text-xs font-bold text-slate-400 mb-1">Today, 10:24 AM</div>
                        <div className="text-sm text-slate-700">Stan added this lead from research.</div>
                      </div>
                      <div className="relative pl-6 border-l-2 border-slate-100">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-200 border-4 border-white shadow-sm" />
                        <div className="text-xs font-bold text-slate-400 mb-1">Yesterday, 4:15 PM</div>
                        <div className="text-sm text-slate-700">Lead identified on LinkedIn.</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-4">
                  <button className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all">
                    Send Message
                  </button>
                  <button className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all">
                    Add to Sequence
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderSequences = () => {
    if (selectedSequence) {
      return (
        <div className="flex-1 bg-white overflow-auto flex flex-col">
          {sequenceViewTab === 'editor' ? (
            <>
              {/* Editor Header */}
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-20">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setSelectedSequence(null)}
                    className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <div className="flex items-center gap-3">
                    <h2 className="text-[20px] font-bold text-slate-900 tracking-tight">{selectedSequence.title}</h2>
                    <button className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1 bg-white text-[#10b981] rounded-full border border-[#10b981]">
                    <div className="w-[7px] h-[7px] rounded-full bg-[#10b981] animate-pulse" />
                    <span className="text-[11px] font-bold">Running</span>
                  </div>
                  <button onClick={() => setSequenceViewTab('progress')} className="px-4 py-2 bg-black text-white rounded-[10px] text-[13px] font-bold hover:bg-slate-800 transition-all shadow-sm">
                    View Progress
                  </button>
                </div>
              </div>

              {/* Editor Canvas */}
              <div className="flex-1 bg-white p-12 relative min-h-fit">
                <div className="max-w-2xl mx-auto flex flex-col items-center">
                  <div className="text-right w-full mb-8">
                    <p className="text-[11px] font-semibold text-slate-600">{selectedSequence.schedule}</p>
                  </div>

                  <div className="flex flex-col items-center w-full space-y-0">
                    {selectedSequence.steps.map((step: any, index: number) => (
                      <React.Fragment key={step.id}>
                        {step.type === 'Wait' ? (
                          <div className="flex flex-col items-center py-4">
                            <div className="w-px h-6 bg-slate-200 mb-4" />
                            <div className="flex flex-col items-center">
                              <span className="text-slate-300 mb-2 leading-none">↓</span>
                              <div 
                                onClick={() => setEditingStep(step)}
                                className="flex items-center gap-2 px-4 py-1.5 bg-orange-50/50 text-orange-400 rounded-full cursor-pointer hover:bg-orange-50 transition-all"
                              >
                                <Clock className="w-[14px] h-[14px]" />
                                <span className="text-[13px] font-bold">{step.title}</span>
                              </div>
                            </div>
                            <div className="w-px h-6 bg-slate-200 mt-4" />
                          </div>
                        ) : (
                          <div className="flex flex-col items-center w-full">
                            {index > 0 && selectedSequence.steps[index-1].type !== 'Wait' && (
                              <div className="flex flex-col items-center py-2">
                                <span className="text-slate-300 leading-none">↓</span>
                              </div>
                            )}
                            <div 
                              onClick={() => setEditingStep(step)}
                              className={cn(
                                "max-w-sm w-full bg-white border border-slate-200 rounded-xl p-5 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:shadow-md transition-all group cursor-pointer relative",
                                step.type === 'LinkedIn' && "border-blue-300 shadow-blue-100/50"
                              )}
                            >
                              <div className="flex items-start gap-4">
                                <div className={cn(
                                  "w-6 h-6 rounded flex items-center justify-center shrink-0",
                                  step.type === 'Enroll' ? "bg-slate-50 text-slate-400" :
                                  step.type === 'Email' ? "text-slate-600" :
                                  "text-blue-500"
                                )}>
                                  {step.type === 'Enroll' && <Users className="w-4 h-4" />}
                                  {step.type === 'Email' && <Mail className="w-4 h-4" />}
                                  {step.type === 'LinkedIn' && <div className="text-[13px] font-bold font-serif bg-blue-500 text-white w-full h-full rounded flex items-center justify-center leading-none tracking-tighter">in</div>}
                                </div>
                                <div className="flex-1 mt-0.5">
                                  <h4 className="font-bold text-slate-900 text-[13px] leading-tight">{step.title}</h4>
                                  <p className="text-[13px] text-slate-400 mt-1.5 leading-snug">{step.subtitle}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 bg-white overflow-auto">
              <div className="p-8 max-w-[1400px] mx-auto w-full">
                <button onClick={() => setSequenceViewTab('editor')} className="flex items-center gap-2 text-slate-600 text-[13px] font-bold mb-6 hover:text-slate-900 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                  Back to sequence editor
                </button>
                <h1 className="text-[26px] font-bold text-slate-900 mb-8 tracking-tight">{selectedSequence.title}</h1>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                  <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2">
                       <Users className="w-4 h-4 text-slate-500" />
                       <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Leads enrolled in the sequence</span>
                    </div>
                    <div className="text-[26px] font-bold text-slate-900 mt-1">404</div>
                  </div>
                  <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2">
                       <Activity className="w-4 h-4 text-slate-500" />
                       <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Leads still active</span>
                    </div>
                    <div className="text-[26px] font-bold text-slate-900 mt-1">92</div>
                  </div>
                  <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2">
                       <Clock className="w-4 h-4 text-slate-500" />
                       <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Leads in the email queue</span>
                    </div>
                    <div className="text-[26px] font-bold text-slate-900 mt-1">1</div>
                  </div>
                  <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm">
                    <div className="flex items-center gap-2.5 mb-2">
                       <BarChart2 className="w-4 h-4 text-slate-500" />
                       <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Completion Rate</span>
                    </div>
                    <div className="text-[26px] font-bold text-slate-900 mt-1">77%</div>
                  </div>
                </div>

                <div className="flex gap-4 mb-6">
                  <div className="relative w-[320px]">
                    <input 
                      type="text" 
                      placeholder="Search leads, emails, ..." 
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[13.5px] focus:ring-2 focus:ring-brand-500/20"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                      <Search className="w-4 h-4" />
                    </div>
                  </div>
                  <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-medium text-slate-700 flex items-center justify-between w-40 hover:bg-slate-50">
                    All Status <ChevronDown className="w-4 h-4 text-slate-300" />
                  </button>
                  <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-medium text-slate-700 flex items-center justify-between w-40 hover:bg-slate-50">
                    Newest First <ChevronDown className="w-4 h-4 text-slate-300" />
                  </button>
                </div>

                <div className="border border-slate-100 rounded-2xl overflow-hidden mt-4">
                  <table className="w-full text-left border-collapse bg-white">
                    <thead>
                      <tr className="border-b border-slate-100 bg-white">
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400">Lead</th>
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400 flex items-center gap-1">Status <ChevronDown className="w-3 h-3" /></th>
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400">Next Action</th>
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400 flex items-center gap-1">Last Contacted At <ChevronDown className="w-3 h-3" /></th>
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400 flex items-center gap-1">LinkedIn Invited At <ChevronDown className="w-3 h-3" /></th>
                        <th className="px-6 py-4 text-[13px] font-medium text-slate-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50/50">
                      {[
                        { name: 'Steffen Petersen', email: 'steffen@getsona.com', comp: 'Sona (getsona.com)', stat: 'Running', next: 'Send email', btn: 'green', last: 'Never', inv: 'N/A' },
                        { name: 'Joyce Hampton', email: 'hamptonj@elms.edu', comp: 'Elms College', stat: 'Running', next: 'Send email', btn: 'green', last: 'Never', inv: 'N/A' },
                        { name: 'Sandie Jones', email: 'sandie.jones@brado.net', comp: 'Brado', stat: 'Running', next: 'Waiting for 3 days', btn: 'orange', last: 'Apr 07 11:39:30', inv: 'N/A' },
                        { name: 'Colin McDuffie', email: 'colin.mcduffie@serenaandlily.com', comp: 'Serena & Lily', stat: 'Running', next: 'Waiting for 3 days', btn: 'orange', last: 'Apr 07 11:34:29', inv: 'N/A' },
                        { name: 'Matthew Dwinell', email: 'matthew.dwinell@brooklinen.com', comp: 'Brooklinen', stat: 'Running', next: 'Waiting for 3 days', btn: 'orange', last: 'Apr 07 11:29:28', inv: 'N/A' },
                      ].map((enr, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="text-[13.5px] font-bold text-slate-900 mb-0.5">{enr.name}</div>
                            <div className="text-[12.5px] text-slate-500">{enr.email}</div>
                            <div className="text-[12.5px] text-slate-400">{enr.comp}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-[5px] h-[5px] rounded-full bg-blue-500" />
                              <span className="text-[13px] font-bold text-slate-700">{enr.stat}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("px-2.5 py-1 rounded-[4px] border text-[11.5px] font-bold", enr.btn === 'green' ? "border-[#10b981]/30 text-[#10b981] bg-[#10b981]/5" : "border-orange-300 text-orange-400 bg-orange-50/50")}>
                              {enr.next}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-[13px] text-slate-500">{enr.last}</td>
                          <td className="px-6 py-4 text-[13px] text-slate-500">{enr.inv}</td>
                          <td className="px-6 py-4">
                            <button className="text-rose-400 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4 fill-current" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 bg-slate-50/50 p-8 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Outreach Sequences</h2>
            <button 
              onClick={() => {
                const newSeq = {
                  id: Date.now(),
                  title: "New Sequence",
                  date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                  status: "Draft",
                  schedule: "Not scheduled",
                  steps: [{ id: Date.now(), type: "Enroll", title: "Enroll leads", subtitle: "Status: New Lead" }]
                };
                setSequences([...sequences, newSeq]);
                setSelectedSequence(newSeq);
              }}
              className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Sequence
            </button>
          </div>
          {sequences.map((seq) => (
            <div 
              key={seq.id}
              onClick={() => setSelectedSequence(seq)}
              className="bg-white border-2 border-brand-500/20 rounded-2xl p-6 hover:border-brand-500/40 transition-all cursor-pointer group relative"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-brand-500 rounded-xl flex items-center justify-center text-white">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 group-hover:text-brand-600 transition-colors">{seq.title}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs font-bold text-slate-400">{seq.date}</span>
                      <div className={cn(
                        "flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
                        seq.status === 'Running' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-50 text-slate-600 border-slate-100"
                      )}>
                        {seq.status === 'Running' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        <span className="text-[10px] font-bold uppercase tracking-wider">{seq.status}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <button className="p-2 hover:bg-slate-50 rounded-lg text-slate-400">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderStepEditor = () => {
    if (!editingStep) return null;

    return (
      <AnimatePresence>
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => setEditingStep(null)}
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-bold text-slate-900">Edit Step</h2>
              <button onClick={() => setEditingStep(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Step Type</label>
                <div className="grid grid-cols-3 gap-3">
                  {['Email', 'SMS', 'LinkedIn', 'Wait', 'Social'].map(type => (
                    <button 
                      key={type}
                      onClick={() => setEditingStep({...editingStep, type})}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold border transition-all",
                        editingStep.type === type 
                          ? "bg-brand-600 border-brand-600 text-white shadow-lg shadow-brand-500/20" 
                          : "bg-white border-slate-200 text-slate-600 hover:border-brand-200"
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Title</label>
                <input 
                  type="text" 
                  value={editingStep.title}
                  onChange={e => setEditingStep({...editingStep, title: e.target.value})}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Subtitle / Content</label>
                <textarea 
                  value={editingStep.subtitle}
                  onChange={e => setEditingStep({...editingStep, subtitle: e.target.value})}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button 
                onClick={() => setEditingStep(null)}
                className="flex-1 px-6 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const updatedSequences = sequences.map(seq => {
                    if (seq.id === selectedSequence.id) {
                      return {
                        ...seq,
                        steps: seq.steps.map((s: any) => s.id === editingStep.id ? editingStep : s)
                      };
                    }
                    return seq;
                  });
                  setSequences(updatedSequences);
                  setSelectedSequence(updatedSequences.find(s => s.id === selectedSequence.id));
                  setEditingStep(null);
                }}
                className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20"
              >
                Save Changes
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  };

  const renderBlogPosts = () => {
    const myTasks = tasks.filter((t) => t.assigneeId && t.assigneeId.startsWith('blog-writer') && (t.executionType === 'blog_draft' || t.executionType === 'blog_post'));
    const posts = myTasks.map(t => ({
      id: t.id,
      title: t.title,
      date: t.dueDate || 'Drafting',
      image: t.artifact?.imageUrl || null,
      content: t.artifact?.body || t.description || 'Draft pending...'
    }));

    return (
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Sub Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex gap-6">
            <button 
              onClick={() => setBlogViewTab('list')}
              className={cn("text-sm font-bold pb-4 -mb-4 transition-colors", blogViewTab === 'list' ? "text-slate-900 border-b-2 border-slate-900" : "text-slate-400 hover:text-slate-600")}
            >List</button>
            <button 
              onClick={() => setBlogViewTab('calendar')}
              className={cn("text-sm font-bold pb-4 -mb-4 transition-colors", blogViewTab === 'calendar' ? "text-slate-900 border-b-2 border-slate-900" : "text-slate-400 hover:text-slate-600")}
            >Calendar</button>
          </div>
          <button onClick={onManageAccounts} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
            <Users className="w-4 h-4" />
            Accounts
          </button>
        </div>

        {blogViewTab === 'list' ? (
          <div className="flex-1 overflow-y-auto p-8 bg-slate-50/20">
            <p className="text-[13px] font-medium text-slate-400 mb-6 tracking-wide">Showing 1-{posts.length} of {posts.length} blog posts</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map(post => (
                <div 
                  key={post.id} 
                  onClick={() => setSelectedBlogPost(post)}
                  className="group flex flex-col bg-white border border-emerald-100/50 rounded-[14px] overflow-hidden shadow-sm hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer"
                >
                  {post.image && (
                    <div className="aspect-[2.5/1] bg-slate-100 overflow-hidden relative">
                      <img src={post.image} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-[22px] h-[22px] rounded-full bg-slate-100 text-brand-600 flex items-center justify-center border border-slate-200">
                        <svg className="w-3.5 h-3.5 fill-current text-brand-500" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.111 16.331c-.961 1.761-2.923 2.922-5.111 2.922s-4.15-1.161-5.111-2.922c2.091-.122 3.633-1.632 3.633-3.633 0-1.89-1.393-3.036-3.155-3.036-.339 0-.671.054-.984.153C7.234 6.772 9.426 4.966 12 4.966s4.766 1.806 5.617 4.849c-.313-.099-.645-.153-.984-.153-1.762 0-3.155 1.146-3.155 3.036 0 2.001 1.542 3.511 3.633 3.633z"/></svg>
                      </div>
                      <span className="text-[11.5px] font-bold text-slate-500">{(post.date && post.date !== 'Drafting') ? post.date : '3:00 PM'}</span>
                    </div>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-snug mb-4 group-hover:text-emerald-700 transition-colors line-clamp-3">
                      {post.title}
                    </h3>
                    <div className="mt-auto flex justify-between text-slate-300 items-center">
                      <div className="flex gap-2">
                        <Calendar className="w-4 h-4 hover:text-slate-500" />
                        <MoreHorizontal className="w-4 h-4 hover:text-slate-500" />
                      </div>
                      <button className="text-rose-400 hover:text-rose-500" onClick={(e) => { e.stopPropagation(); }}><Trash2 className="w-[15px] h-[15px]" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-slate-50/20 overflow-hidden">
            {/* Calendar Sub-Header */}
            <div className="px-6 py-3 flex items-center justify-center bg-white border-b border-slate-100 flex-shrink-0 z-10 w-full">
              <div className="flex items-center gap-3 text-slate-800 font-bold text-[15px]">
                <button className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-5 h-5" /></button>
                Apr 6 - Apr 12
                <button className="text-slate-400 hover:text-slate-600"><ChevronRight className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-auto flex scroll-smooth relative">
              <div className="flex min-w-max px-6 py-6 gap-6 items-start bottom-0">
                {/* Drafts Column */}
                <div className="w-[280px] flex flex-col flex-shrink-0 border-r border-slate-100/0 pr-2">
                  <div className="text-[13px] font-semibold text-slate-500 mb-5 flex justify-center py-2">{posts.filter(p => !p.date || p.date.toUpperCase() === 'DRAFT' || p.date.toLowerCase() === 'drafting').length} Drafts</div>
                  <div className="flex flex-col gap-4">
                    {posts.filter(p => !p.date || p.date.toUpperCase() === 'DRAFT' || p.date.toLowerCase() === 'drafting').map(post => (
                      <div 
                        key={post.id}
                        onClick={() => setSelectedBlogPost({ ...post, date: 'Drafting' })}
                        className="bg-white border border-slate-200 hover:border-emerald-300 rounded-[14px] flex flex-col shadow-sm hover:shadow-md transition-all cursor-pointer group overflow-hidden"
                      >
                        {post.image && (
                          <div className="aspect-[2/1] bg-slate-100 overflow-hidden relative">
                            <img src={post.image} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="p-4 flex-1 flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <div className="w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center">
                              <svg className="w-3.5 h-3.5 fill-current text-brand-600" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.111 16.331c-.961 1.761-2.923 2.922-5.111 2.922s-4.15-1.161-5.111-2.922c2.091-.122 3.633-1.632 3.633-3.633 0-1.89-1.393-3.036-3.155-3.036-.339 0-.671.054-.984.153C7.234 6.772 9.426 4.966 12 4.966s4.766 1.806 5.617 4.849c-.313-.099-.645-.153-.984-.153-1.762 0-3.155 1.146-3.155 3.036 0 2.001 1.542 3.511 3.633 3.633z"/></svg>
                            </div>
                            <span className="text-[11px] font-bold text-slate-400">10:00 AM</span>
                          </div>
                          <div className="text-[14px] text-slate-800 font-bold leading-snug line-clamp-3 mb-4 group-hover:text-emerald-700 transition-colors">
                            {post.title}
                          </div>
                          <div className="mt-auto flex justify-between text-slate-300 items-center">
                            <div className="flex gap-2">
                              <Calendar className="w-3.5 h-3.5" />
                              <MoreHorizontal className="w-4 h-4" />
                            </div>
                            <button className="text-rose-400 hover:text-rose-500"><Trash2 className="w-[14px] h-[14px]" /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Calendar Columns */}
                {[
                  { id: 'mon', label: 'Mon 6', isActive: false },
                  { id: 'tue', label: 'Tue 7', isActive: false },
                  { id: 'wed', label: 'Wed 8', isActive: true },
                  { id: 'thu', label: 'Thu 9', isActive: false },
                  { id: 'fri', label: 'Fri 10', isActive: false }
                ].map((day, dayIndex, daysArr) => {
                   const scheduledPosts = posts.filter(p => p.date && p.date.toUpperCase() !== 'DRAFT' && p.date.toLowerCase() !== 'drafting');
                   const assignedPosts = scheduledPosts.filter((_, i) => (i % daysArr.length) === dayIndex);

                   return (
                    <div key={day.id} className="w-[280px] flex flex-col flex-shrink-0 relative">
                      <div className={cn("text-[13.5px] text-center mb-5 py-2.5 rounded-xl transition-colors font-medium", day.isActive ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-500")}>
                        {day.label}
                      </div>
                      <div className="flex flex-col gap-4 relative">
                        {assignedPosts.map(post => (
                          <div 
                            key={post.id}
                            onClick={() => setSelectedBlogPost({ ...post, date: day.label })}
                            className="bg-white border border-slate-200 hover:border-emerald-300 rounded-[14px] flex flex-col shadow-sm hover:shadow-md transition-all cursor-pointer group overflow-hidden"
                          >
                            {post.image && (
                              <div className="aspect-[2/1] bg-slate-100 overflow-hidden relative">
                                <img src={post.image} alt="Preview" className="w-full h-full object-cover" />
                              </div>
                            )}
                            <div className="p-4 flex-1 flex flex-col">
                              <div className="flex items-center justify-between mb-3">
                                <div className="w-6 h-6 rounded-full border border-slate-200 flex items-center justify-center">
                                  <svg className="w-3.5 h-3.5 fill-current text-brand-600" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.111 16.331c-.961 1.761-2.923 2.922-5.111 2.922s-4.15-1.161-5.111-2.922c2.091-.122 3.633-1.632 3.633-3.633 0-1.89-1.393-3.036-3.155-3.036-.339 0-.671.054-.984.153C7.234 6.772 9.426 4.966 12 4.966s4.766 1.806 5.617 4.849c-.313-.099-.645-.153-.984-.153-1.762 0-3.155 1.146-3.155 3.036 0 2.001 1.542 3.511 3.633 3.633z"/></svg>
                                </div>
                                <span className="text-[11px] font-bold text-slate-800">3:00 PM</span>
                              </div>
                              <div className="text-[14px] text-slate-800 font-bold leading-snug line-clamp-3 mb-4 group-hover:text-emerald-700 transition-colors">
                                {post.title}
                              </div>
                              <div className="mt-auto flex justify-between text-slate-300 items-center">
                                <div className="flex gap-2">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <MoreHorizontal className="w-4 h-4" />
                                </div>
                                <button className="text-rose-400 hover:text-rose-500"><Trash2 className="w-[14px] h-[14px]" /></button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                   );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Full Preview Modal */}
        <AnimatePresence>
          {selectedBlogPost && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setSelectedBlogPost(null)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white w-full max-w-3xl max-height-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-900">Blog Post Preview</h2>
                  <div className="flex gap-2">
                    <button onClick={() => handleDeleteDraft(selectedBlogPost.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg font-bold text-sm px-4">
                      Delete Draft
                    </button>
                    <button onClick={() => setSelectedBlogPost(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-12">
                  <div className="max-w-2xl mx-auto">
                    <div className="text-sm font-bold text-brand-600 mb-4 uppercase tracking-widest">{selectedBlogPost.date}</div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-8 leading-tight">{selectedBlogPost.title}</h1>
                    {selectedBlogPost.image && (
                      <img src={selectedBlogPost.image} alt="Hero" className="w-full rounded-2xl mb-8 shadow-lg" referrerPolicy="no-referrer" />
                    )}
                    <div className="markdown-body text-slate-700 leading-relaxed text-lg">
                      <Markdown remarkPlugins={[remarkGfm]}>{selectedBlogPost.content}</Markdown>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderNewsletters = () => {
    const myTasks = tasks.filter((t) => t.assigneeId && t.assigneeId.startsWith('blog-writer') && t.executionType === 'newsletter_draft');
    const posts = myTasks.map(t => ({
      id: t.id,
      title: t.title,
      date: t.dueDate || 'Drafting',
      image: t.artifact?.imageUrl || null,
      content: t.artifact?.body || t.description || 'Draft pending...'
    }));

    return (
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Sub Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex gap-6">
            <button className="text-sm font-bold text-slate-900 border-b-2 border-slate-900 pb-4 -mb-4">List</button>
            <button className="text-sm font-bold text-slate-400 hover:text-slate-600 pb-4 -mb-4">Calendar</button>
          </div>
          <button onClick={onManageAccounts} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
            <Users className="w-4 h-4" />
            Accounts
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <p className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-wider">Showing {posts.length} Newsletters</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map(post => (
              <div 
                key={post.id} 
                onClick={() => setSelectedBlogPost(post)}
                className="group flex flex-col bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer"
              >
                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="text-[15px] font-bold text-slate-900 leading-snug mb-4 group-hover:text-brand-600 transition-colors">
                    {post.title}
                  </h3>
                  {post.image && (
                    <div className="aspect-video rounded-xl overflow-hidden mb-4 bg-slate-100">
                      <img src={post.image} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  {post.content && !post.image && (
                    <div className="flex-1 overflow-hidden mb-4 relative">
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white pointer-events-none z-10" />
                      <div className="text-sm text-slate-500 overflow-hidden line-clamp-[8] opacity-75">
                         <Markdown remarkPlugins={[remarkGfm]}>{post.content}</Markdown>
                      </div>
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-end gap-3 text-slate-300">
                    <button className="hover:text-slate-500"><Calendar className="w-4 h-4" /></button>
                    <button className="hover:text-slate-500"><MoreHorizontal className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Full Preview Modal */}
        <AnimatePresence>
          {selectedBlogPost && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setSelectedBlogPost(null)}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white w-full max-w-3xl max-height-[90vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-900">Newsletter Preview</h2>
                  <div className="flex gap-2">
                    <button onClick={() => handleDeleteDraft(selectedBlogPost.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg font-bold text-sm px-4">
                      Delete Draft
                    </button>
                    <button onClick={() => setSelectedBlogPost(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-12">
                  <div className="max-w-2xl mx-auto">
                    <div className="text-sm font-bold text-brand-600 mb-4 uppercase tracking-widest">{selectedBlogPost.date}</div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-8 leading-tight">{selectedBlogPost.title}</h1>
                    {selectedBlogPost.image && (
                      <img src={selectedBlogPost.image} alt="Hero" className="w-full rounded-2xl mb-8 shadow-lg" referrerPolicy="no-referrer" />
                    )}
                    <div className="markdown-body text-slate-700 leading-relaxed text-lg">
                      <Markdown remarkPlugins={[remarkGfm]}>{selectedBlogPost.content}</Markdown>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderCalls = () => {
    return (
      <div className="flex-1 bg-white overflow-auto flex flex-col items-center">
        <div className="p-8 pb-12 mx-auto w-full max-w-5xl">
          <div className="flex items-center gap-2 mb-6">
            <h1 className="text-[20px] font-bold text-slate-900">{agent.name}'s number</h1>
            <span className="text-[18px] font-bold text-slate-400">+19206058097</span>
          </div>

          <div className="flex items-center justify-between gap-4 mb-6 relative">
            <div className="relative w-full max-w-sm">
              <input 
                type="text" 
                placeholder="Search by phone" 
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] focus:ring-2 focus:ring-brand-500/20"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Search className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm">
                <Filter className="w-4 h-4" /> Filters
              </button>
              <div className="text-[13px] font-semibold text-slate-400">1 call</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex items-stretch">
            <div className="p-6 flex-1 pr-12 min-w-[280px]">
              <div className="flex items-center gap-2 mb-3">
                <Phone className="w-4 h-4 text-slate-600" />
                <span className="text-[17px] font-black text-slate-900">+12089730597</span>
              </div>
              <div className="flex items-center gap-2 mb-4 text-[13.5px]">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-slate-500">0m 39s</span>
                <span className="text-blue-500 font-black px-1.5">•</span>
                <span className="text-slate-500 flex items-center gap-1.5">😐 Neutral</span>
              </div>
              <div className="text-[12px] font-semibold text-slate-400">17 Feb 2026</div>
            </div>

            <div className="flex-[2] bg-slate-50 border-l border-slate-200 p-6 flex flex-col justify-center">
               <div className="bg-white border text-[14px] leading-relaxed text-slate-600 italic border-slate-100 rounded-lg p-5 shadow-sm border-l-4 border-l-blue-500 flex gap-3 relative">
                 <MessageSquare className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                 I called to reach Marcus, asked if the user was there or wanted to leave a message, but they didn't respond and hung up.
                 <button className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-blue-500 border border-blue-50 hover:bg-blue-50 transition-colors">
                   <Play className="w-4 h-4 ml-0.5" />
                 </button>
               </div>
            </div>
          </div>
          
          <div className="mt-8 flex justify-end items-center gap-2">
            <button className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-50 disabled:opacity-50" disabled>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-[13px] font-bold text-slate-600 shadow-sm">
              1
            </div>
            <button className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:bg-slate-50 disabled:opacity-50" disabled>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>
    );
  };

  const renderDocuments = () => {
    const documents = [
      { id: 1, name: ' Privacy Policy - Marblism.pdf', size: '1.2 MB', date: 'Feb 28, 2026', type: 'PDF' },
      { id: 2, name: 'Terms of Service - Draft v2.docx', size: '450 KB', date: 'Feb 27, 2026', type: 'DOCX' },
      { id: 3, name: 'GDPR Compliance Checklist.xlsx', size: '850 KB', date: 'Feb 25, 2026', type: 'XLSX' },
      { id: 4, name: 'Data Processing Agreement.pdf', size: '2.1 MB', date: 'Feb 24, 2026', type: 'PDF' },
      { id: 5, name: 'Employment Contract Template.pdf', size: '1.5 MB', date: 'Feb 22, 2026', type: 'PDF' },
    ];

    return (
      <div className="flex-1 bg-slate-50/30 p-8 overflow-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Shared Documents</h2>
              <p className="text-sm text-slate-500 mt-1">Legal documents and drafts shared with {agent.name}</p>
            </div>
            <button className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Upload Document
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Size</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Shared Date</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          doc.type === 'PDF' ? "bg-red-50 text-red-600" :
                          doc.type === 'DOCX' ? "bg-blue-50 text-blue-600" :
                          "bg-emerald-50 text-emerald-600"
                        )}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-900">{doc.name}</div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{doc.type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{doc.size}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{doc.date}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                          <Download className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Empty State Illustration if no docs (not used here but for future) */}
          {documents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <File className="w-10 h-10 text-slate-200" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">No documents yet</h3>
              <p className="text-sm text-slate-500 max-w-xs mt-2">Shared files and legal drafts will appear here once they are available.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const handleClickOutside = () => {
      if (isMoreMenuOpen) setIsMoreMenuOpen(false);
    };
    if (isMoreMenuOpen) document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMoreMenuOpen]);

  const handleExportChat = () => {
    const exportText = messages.map(m => `[${new Date(m.timestamp).toLocaleString()}] ${m.senderName}: ${m.content}`).join('\n\n');
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name.replace(/\s+/g, '-').toLowerCase()}-chat-export.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setIsMoreMenuOpen(false);
    toast.success('Chat exported successfully');
  };

  const handleClearHistory = () => {
    setIsMoreMenuOpen(false);
    setShowClearHistoryModal(true);
  };

  const handleClearHistoryConfirm = async () => {
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${agent.id}/messages`, {
        method: 'DELETE',
        token,
        onAuthFailure
      });
      setShowClearHistoryModal(false);
      toast.success('Chat history cleared');
      // Simulate reload to clear UI since the app lacks a direct context method here
      window.location.reload();
    } catch (e) {
      toast.error('Failed to clear history');
    }
  };

  const tabs = agent.id.startsWith('social-media-manager')
    ? ['Chat', 'Posts', 'Guidelines'] 
    : agent.id.startsWith('blog-writer')
    ? ['Chat', 'Blog Posts', 'Newsletters', 'Guidelines']
    : agent.id.startsWith('sales-associate')
    ? ['Chat', 'Leads', 'Sequence', 'Guidelines']
    : agent.id.startsWith('legal-associate')
    ? ['Chat', 'Documents', 'Guidelines']
    : agent.id.startsWith('receptionist')
    ? ['Chat', 'Calls', 'Guidelines']
    : ['Chat', 'Guidelines'];

  const latestAgentMessage = [...messages].reverse().find(m => m.type === 'agent');
  const latestAgentMessageId = latestAgentMessage?.id;
  const activeDraftTasks = tasks
    .filter(t => t.assigneeId && t.assigneeId.startsWith(agent.id) && (t.status === 'todo' || t.status === 'running'))
    .slice(0, 4);

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <button 
              onClick={onBack}
              className="md:hidden p-2 -ml-2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
            <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-base md:text-lg leading-tight truncate">{agent.role}</h2>
            <p className="text-xs md:text-sm text-slate-500 truncate">{agent.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-slate-400">
          <button 
            onClick={() => setActiveTab('Guidelines')}
            className={cn(
              "hidden sm:flex items-center gap-1.5 text-sm font-medium transition-colors",
              activeTab === 'Guidelines' ? "text-brand-600" : "hover:text-slate-600"
            )}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <div className="relative">
            <button 
              onClick={(e) => { e.stopPropagation(); setIsMoreMenuOpen(!isMoreMenuOpen); }}
              className="hover:text-slate-600 transition-colors p-2"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            <AnimatePresence>
              {isMoreMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-xl overflow-hidden z-50 py-1"
                >
                  <button onClick={handleExportChat} className="w-full px-4 py-2 text-left text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <Download className="w-4 h-4 text-slate-400" /> Export Chat
                  </button>
                  <div className="h-px bg-slate-100 my-1 font-bold"></div>
                  <button onClick={handleClearHistory} className="w-full px-4 py-2 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <Trash2 className="w-4 h-4 text-red-500" /> Clear History
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-slate-100 flex gap-8 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "py-3 text-sm font-bold transition-all border-b-2 whitespace-nowrap",
              activeTab === tab 
                ? "text-slate-900 border-brand-500" 
                : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            {tab === 'Chat' && <span className="mr-2">💬</span>}
            {tab === 'Posts' && <span className="mr-2">📝</span>}
            {tab === 'Blog Posts' && <span className="mr-2">📝</span>}
            {tab === 'Newsletters' && <span className="mr-2">💌</span>}
            {tab === 'Leads' && <span className="mr-2">👥</span>}
            {tab === 'Sequence' && <span className="mr-2">📧</span>}
            {tab === 'Calls' && <Phone className="w-4 h-4 mr-2 inline-block -mt-0.5" />}
            {tab === 'Documents' && <span className="mr-2">📂</span>}
            {tab === 'Guidelines' && <span className="mr-2">📁</span>}
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Guidelines' ? renderGuidelines() : activeTab === 'Posts' ? renderPosts() : activeTab === 'Blog Posts' ? renderBlogPosts() : activeTab === 'Newsletters' ? renderNewsletters() : activeTab === 'Leads' ? renderLeads() : activeTab === 'Sequence' ? renderSequences() : activeTab === 'Documents' ? renderDocuments() : activeTab === 'Calls' ? renderCalls() : (
        <>
          {/* Messages */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8"
          >
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-4"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden">
                    <img 
                      src={msg.senderAvatar || (msg.type === 'user' ? "https://api.dicebear.com/7.x/avataaars/svg?seed=marcus" : agent.avatar)} 
                      alt={msg.senderName} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900 text-sm">{msg.senderName}</span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-slate-700 text-[15px] leading-relaxed markdown-body">
                      <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                    </div>
                    {msg.imageUrl && (
                      <div className="mt-4 rounded-2xl overflow-hidden border border-slate-100 shadow-sm max-w-lg">
                        <img 
                          src={msg.imageUrl} 
                          alt="Generated content" 
                          className="w-full h-auto object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    {msg.id === latestAgentMessageId && activeDraftTasks.length > 0 && (
                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                        {activeDraftTasks.map(task => (
                          <div key={task.id} className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-sm flex flex-col group hover:shadow-md transition-shadow">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white">
                              <div className="flex items-center gap-6">
                                <div className="w-7 h-7 rounded-full bg-[#207196] flex items-center justify-center shrink-0">
                                  <svg className="w-[18px] h-[18px] text-white fill-current" viewBox="0 0 24 24"><path d="M12.158 12.786l-2.698 7.84c.806.236 1.657.365 2.54.365 1.047 0 2.05-.18 2.986-.51-.024-.05-.046-.098-.065-.147l-2.763-8.083zM3.076 12c0-3.14 1.636-5.885 4.093-7.442.278.47.456 1.01.456 1.573 0 1.25-.664 2.21-1.346 3.12-.514.68-.973 1.285-.973 2.035 0 1.02.664 1.764 1.346 1.764.49 0 1.013-.25 1.54-.764l-2.887 8.35c-1.353-2.316-2.228-5.32-2.228-8.636zm14.86-5.874c-.665-.794-1.578-1.285-2.28-1.285-.705 0-1.12.515-1.12 1.147 0 .807.54 1.493 1.037 2.132.538.686.974 1.303.974 2.06 0 1.155-.724 1.84-1.47 1.84-.287 0-.58-.088-.87-.272l-1.927 5.766 2.073-6.046c.91-2.628 1.656-5.358 1.656-8.01 0-.91-.18-1.748-.49-2.502h.168c1.378 1.408 2.25 3.336 2.25 5.485 0 2.29-.982 4.015-2.03 5.568zM12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12z"/></svg>
                                </div>
                                <span className="text-[14px] font-medium text-slate-800 flex items-center gap-2.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> {task.dueDate || 'Tomorrow at 3:00 PM'}</span>
                              </div>
                              <div className="flex items-center gap-4 transition-opacity">
                                <button 
                                  onClick={() => {
                                    setEditingTaskScheduleId(task.id);
                                    setTaskScheduleForm({ repeat: task.repeat || '', dueDate: task.dueDate || '' });
                                  }}
                                  className="text-slate-800 hover:text-slate-900 transition-colors"
                                >
                                  <svg className="w-[15px] h-[15px] fill-current" viewBox="0 0 24 24"><path d="M7.127 22.562l-7.127 1.438 1.438-7.128 5.689 5.69zm1.414-1.414l11.228-11.225-5.69-5.692-11.227 11.227 5.689 5.69zm9.768-21.148l-2.816 2.817 5.691 5.691 2.816-2.819-5.691-5.689z"/></svg>
                                </button>
                                <button 
                                  onClick={() => {
                                    setEditingTaskScheduleId(task.id);
                                    setTaskScheduleForm({ repeat: task.repeat || '', dueDate: task.dueDate || '' });
                                  }}
                                  className="text-slate-800 hover:text-slate-900 transition-colors"
                                >
                                  <svg className="w-[15px] h-[15px] fill-current" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm6 13h-7v-7h2v5h5v2z"/></svg>
                                </button>
                                <button className="px-4 py-2 bg-black text-white text-[14px] font-medium rounded-lg flex items-center gap-2 hover:bg-slate-900 transition-colors shadow-sm ml-1">Publish <svg className="w-[15px] h-[15px] fill-current" viewBox="0 0 24 24"><path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332l3.258-4.431-3.258-2.901z"/></svg></button>
                              </div>
                            </div>
                            
                            {editingTaskScheduleId === task.id && (
                              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2 md:gap-4">
                                <input
                                  type="text"
                                  value={taskScheduleForm.dueDate}
                                  onChange={e => setTaskScheduleForm({...taskScheduleForm, dueDate: e.target.value})}
                                  placeholder="Due e.g., Tomorrow at 3PM"
                                  className="px-3 py-1.5 text-sm rounded bg-white border border-slate-200 outline-none focus:border-blue-500 w-[160px] flex-1"
                                />
                                <select
                                  value={taskScheduleForm.repeat}
                                  onChange={e => setTaskScheduleForm({...taskScheduleForm, repeat: e.target.value})}
                                  className="px-3 py-1.5 text-sm rounded bg-white border border-slate-200 outline-none focus:border-blue-500 w-[160px] flex-1"
                                >
                                  <option value="">No Repeat</option>
                                  <option value="Every 10 minutes">10 Minutes</option>
                                  <option value="Every 20 minutes">20 Minutes</option>
                                  <option value="Every 30 minutes">30 Minutes</option>
                                  <option value="Hourly">Hourly</option>
                                  <option value="Daily">Daily</option>
                                  <option value="Weekly">Weekly</option>
                                </select>
                                <div className="flex items-center gap-2 ml-auto w-full sm:w-auto mt-2 sm:mt-0">
                                  <button
                                    onClick={() => handleSaveTaskSchedule(task.id)}
                                    disabled={isUpdatingTask}
                                    className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {isUpdatingTask ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditingTaskScheduleId(null)}
                                    className="flex-1 px-3 py-1.5 text-slate-500 hover:bg-slate-200 text-sm font-medium rounded"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="p-5 flex-1 flex flex-col">
                              <h4 className="font-bold text-slate-900 text-[15px] mb-4 leading-snug">{task.title}</h4>
                              {task.artifact?.imageUrl ? (
                                <div className="mt-auto aspect-video rounded-xl overflow-hidden bg-slate-100">
                                  <img src={task.artifact.imageUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                </div>
                              ) : (
                                <div className="mt-auto h-32 w-full rounded-xl bg-gradient-to-br from-brand-50/50 to-slate-50 border border-slate-100 flex flex-col items-center justify-center text-slate-400 gap-2">
                                  <FileText className="w-6 h-6 text-slate-300" />
                                  <span className="text-xs font-medium">Text Content Draft</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

          </div>

          {/* Input Area */}
          <div className="p-6 bg-white">
            {/* Suggestions */}
            <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSendMessage(s)}
                  className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-full text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="relative">
              {isTyping && (
                <div className="flex items-center gap-2 mb-3 px-3">
                  <img src={agent.avatar} alt={agent.name} className="w-[22px] h-[22px] rounded-full object-cover bg-emerald-500 shadow-sm" />
                  <span className="text-[15px] font-medium text-slate-500 tracking-wide flex items-center">
                    {agent.name.split(' ')[0]} is thinking 
                    <span className="ml-2 flex space-x-1">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                    </span>
                  </span>
                </div>
              )}
              
              <form onSubmit={handleSubmit} className="relative">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileChange}
                  accept="image/*"
                />
                
                {pendingAttachment && (
                  <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between shadow-sm max-w-xs">
                    <div className="flex items-center gap-3">
                      <img src={pendingAttachment} alt="Attachment preview" className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                      <span className="text-xs font-semibold text-slate-600">Image attached</span>
                    </div>
                    <button type="button" onClick={() => setPendingAttachment(null)} className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className={cn("flex items-center bg-white border rounded-2xl px-4 py-3 transition-all shadow-sm", pendingAttachment ? "border-brand-500" : "border-slate-200 focus-within:border-brand-500")}>
                  <button 
                    type="button" 
                    onClick={handleFileClick}
                    disabled={isUploadingAttachment}
                    className={cn("mr-3 transition-colors", isUploadingAttachment ? "text-brand-300 animate-pulse cursor-not-allowed" : "text-slate-400 hover:text-slate-600")}
                  >
                    {isUploadingAttachment ? <span className="w-5 h-5 block border-2 border-brand-300 border-t-brand-500 rounded-full animate-spin" /> : <Paperclip className="w-5 h-5" />}
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={pendingAttachment ? "Add a message about this image..." : "Write message"}
                    className="flex-1 bg-transparent border-none p-0 text-[15px] focus:ring-0 placeholder:text-slate-300"
                  />
                  <button
                    type="submit"
                    disabled={(!input.trim() && !pendingAttachment) || isTyping || isUploadingAttachment}
                    className="ml-3 p-1.5 bg-slate-100 text-slate-300 rounded-lg hover:bg-brand-600 hover:text-white disabled:opacity-50 transition-all"
                  >
                    <ArrowUp className="w-5 h-5" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {showClearHistoryModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-xl max-w-sm w-full relative">
            <button onClick={() => setShowClearHistoryModal(false)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Clear chat history?</h3>
            <p className="text-slate-500 mt-2 text-sm leading-relaxed">Are you sure you want to clear the chat history for {agent.name}? This action cannot be undone.</p>
            <div className="flex items-center gap-3 mt-8">
              <button onClick={() => setShowClearHistoryModal(false)} className="flex-1 px-5 py-2.5 font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">Cancel</button>
              <button 
                onClick={handleClearHistoryConfirm} 
                className="flex-1 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md shadow-red-500/20 transition-all"
              >
                Clear History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
