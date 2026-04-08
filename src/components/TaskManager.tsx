import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Calendar,
  RefreshCw,
  User,
  ChevronRight,
  X,
  AlertCircle,
  LoaderCircle,
  Sparkles
} from 'lucide-react';
import { Task, Agent, Lead } from '../types';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';

interface TaskManagerProps {
  tasks: Task[];
  agents: Agent[];
  token: string | null;
  activeWorkspaceId: number | null;
  workspaceRole?: 'owner' | 'admin' | 'member' | null;
  gmailConnected?: boolean;
  linkedinConnected?: boolean;
  bufferConnected?: boolean;
  wordpressConnected?: boolean;
  hubspotConnected?: boolean;
  onAuthFailure?: () => void;
  onUpdateTask: (id: string, status: Task['status']) => void;
  onCreateTask: (task: Omit<Task, 'id' | 'status'>) => void;
}

type BufferProfile = {
  id: string;
  service: string;
  serviceUsername: string | null;
  formattedUsername: string | null;
  isDefault?: boolean;
};

type DraftComposerState = {
  to: string;
  subject: string;
  body: string;
};

type WorkspaceMediaItem = {
  id: number;
  name: string;
  type?: string;
  thumbnail?: string;
  category?: string;
  created_at?: string;
};

type TaskAutomationLogEntry = {
  id: number;
  action: string;
  details?: {
    reason?: string;
    channel?: string;
    error?: string;
    profileId?: string;
    [key: string]: unknown;
  } | null;
  createdAt?: string | null;
};

const buildWordPressDraftPayload = (task: Task) => {
  if (!task.artifact) {
    return null;
  }

  const bullets = task.artifact.bullets.length > 0
    ? `<ul>${task.artifact.bullets.map((bullet) => `<li>${bullet}</li>`).join('')}</ul>`
    : '';

  return {
    title: task.artifact.title,
    excerpt: task.outputSummary || task.artifact.body,
    content: [
      `<p>${task.artifact.body}</p>`,
      bullets,
    ].filter(Boolean).join('\n'),
    imageUrl: task.artifact.imageUrl || undefined,
  };
};

const buildArtifactDraftPayload = (task: Task, lead: Lead) => {
  if (!task.artifact || !lead.email) {
    return null;
  }

  const bulletLines = task.artifact.bullets.map((bullet) => `- ${bullet}`).join('\n');
  const bodySections = [
    `Hi ${lead.name},`,
    '',
    task.artifact.body,
    bulletLines ? `\n${bulletLines}` : '',
    '',
    'Best,',
    'Marcus',
  ].filter((section) => section !== '');

  return {
    to: lead.email,
    subject: task.artifact.title,
    body: bodySections.join('\n'),
  };
};

const extractFirstUrl = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/https?:\/\/\S+/i);
    if (match) {
      return match[0].replace(/[),.;!?]+$/, '');
    }
  }

  return null;
};

const isImageUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed)) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
  } catch {
    return false;
  }
};

const extractFirstNonImageUrl = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (!value) continue;
    const matches = value.match(/https?:\/\/\S+/gi) || [];
    for (const match of matches) {
      const sanitized = match.replace(/[),.;!?]+$/, '');
      if (!isImageUrl(sanitized)) {
        return sanitized;
      }
    }
  }

  return null;
};

const extractFirstImageUrl = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (!value) continue;

    const dataImageMatch = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/i);
    if (dataImageMatch?.[0]) {
      return dataImageMatch[0];
    }

    const matches = value.match(/https?:\/\/\S+/gi) || [];
    for (const match of matches) {
      const sanitized = match.replace(/[),.;!?]+$/, '');
      if (isImageUrl(sanitized)) {
        return sanitized;
      }
    }
  }

  return null;
};

const buildSocialPostPayload = (task: Task, selectedMediaUrl?: string | null) => {
  if (!task.artifact) {
    return null;
  }

  const textParts = [
    task.artifact.title,
    task.artifact.body,
    ...task.artifact.bullets.map((bullet) => `- ${bullet}`),
  ].filter(Boolean);
  const text = textParts.join('\n\n').trim();
  const link = extractFirstNonImageUrl(task.outputSummary, task.artifact.body, task.description);
  const imageUrl = selectedMediaUrl && isImageUrl(selectedMediaUrl)
    ? selectedMediaUrl
    : extractFirstImageUrl(task.artifact.imageUrl, task.outputSummary, task.artifact.body, task.description);

  return {
    text: text.length > 2800 ? `${text.slice(0, 2797)}...` : text,
    link,
    imageUrl,
    title: task.artifact.title,
    description: task.outputSummary || task.artifact.body,
  };
};

const formatExecutionType = (executionType?: Task['executionType']) => {
  switch (executionType) {
    case 'research':
      return 'Research';
    case 'draft':
      return 'Draft';
    case 'outreach':
      return 'Outreach';
    case 'review':
      return 'Review';
    default:
      return 'Generic';
  }
};

const formatTimestamp = (value?: number | null) => {
  if (!value) return 'Not recorded';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
};

const getTaskState = (task: Task): 'failed' | 'running' | 'done' | 'todo' => {
  if (task.lastError) return 'failed';
  if (task.status === 'running') return 'running';
  if (task.status === 'done') return 'done';
  return 'todo';
};

const getStatusBadge = (task: Task) => {
  const state = getTaskState(task);

  switch (state) {
    case 'failed':
      return {
        label: 'Needs attention',
        className: 'bg-rose-50 text-rose-600',
      };
    case 'running':
      return {
        label: 'Running',
        className: 'bg-amber-50 text-amber-700',
      };
    case 'done':
      return {
        label: 'Done',
        className: 'bg-emerald-50 text-emerald-600',
      };
    default:
      return {
        label: 'To do',
        className: 'bg-slate-100 text-slate-600',
      };
  }
};

const getStatusIcon = (task: Task) => {
  const state = getTaskState(task);

  switch (state) {
    case 'failed':
      return <AlertCircle className="w-5 h-5 text-rose-500" />;
    case 'running':
      return <LoaderCircle className="w-5 h-5 text-amber-500 animate-spin" />;
    case 'done':
      return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    default:
      return <Circle className="w-5 h-5 text-brand-500" />;
  }
};

export const TaskManager: React.FC<TaskManagerProps> = ({
  tasks,
  agents,
  token,
  activeWorkspaceId,
  workspaceRole = null,
  gmailConnected = false,
  linkedinConnected = false,
  bufferConnected = false,
  wordpressConnected = false,
  hubspotConnected = false,
  onAuthFailure,
  onUpdateTask,
  onCreateTask,
}) => {
  const [filter, setFilter] = useState<'all' | 'todo' | 'running' | 'done' | 'failed'>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | ''>('');
  const [promotionState, setPromotionState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [draftComposer, setDraftComposer] = useState<DraftComposerState | null>(null);
  const [draftState, setDraftState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [wordpressState, setWordpressState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [linkedinState, setLinkedinState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [bufferState, setBufferState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [hubspotState, setHubspotState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [mediaItems, setMediaItems] = useState<WorkspaceMediaItem[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  const [bufferProfiles, setBufferProfiles] = useState<BufferProfile[]>([]);
  const [selectedBufferProfileId, setSelectedBufferProfileId] = useState<string>('');
  const [automationLogs, setAutomationLogs] = useState<TaskAutomationLogEntry[]>([]);
  const [automationRetryState, setAutomationRetryState] = useState<{ status: 'idle' | 'saving' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [newTask, setNewTask] = useState<Omit<Task, 'id' | 'status'>>({
    title: '',
    description: '',
    assigneeId: agents[0]?.id || '',
    dueDate: 'Tomorrow, 9:00 AM',
    repeat: ''
  });

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true;
    if (filter === 'failed') return Boolean(task.lastError);
    return task.status === filter;
  });

  const selectedTask = tasks.find(t => t.id === selectedTaskId);
  const assignee = selectedTask ? agents.find(a => a.id === selectedTask.assigneeId) : null;
  const selectedTaskBadge = selectedTask ? getStatusBadge(selectedTask) : null;
  const canRetryAutomation = workspaceRole === 'owner' || workspaceRole === 'admin';
  const selectedLead = selectedLeadId === '' ? null : leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const socialMediaItems = mediaItems.filter((item) => typeof item.thumbnail === 'string' && isImageUrl(item.thumbnail));
  const selectedMediaItem = selectedMediaId ? socialMediaItems.find((item) => item.id === selectedMediaId) ?? null : null;
  const selectedMediaUrl = selectedMediaItem?.thumbnail || null;

  useEffect(() => {
    if (!activeWorkspaceId || !token) {
      setLeads([]);
      setMediaItems([]);
      setBufferProfiles([]);
      return;
    }

    apiFetch<Lead[]>(`/api/workspaces/${activeWorkspaceId}/leads`, {
      token,
      onAuthFailure,
    })
      .then((data) => setLeads(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error('Failed to fetch leads for task promotion', error);
        setLeads([]);
      });

    apiFetch<WorkspaceMediaItem[]>(`/api/workspaces/${activeWorkspaceId}/media`, {
      token,
      onAuthFailure,
    })
      .then((data) => setMediaItems(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error('Failed to fetch workspace media', error);
        setMediaItems([]);
      });

    if (!bufferConnected) {
      setBufferProfiles([]);
      setSelectedBufferProfileId('');
      return;
    }

    apiFetch<{ profiles?: BufferProfile[] }>(`/api/workspaces/${activeWorkspaceId}/integrations/buffer/status`, {
      token,
      onAuthFailure,
    })
      .then((data) => {
        const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
        setBufferProfiles(profiles);
        const defaultProfile = profiles.find((profile) => profile.isDefault) || profiles[0];
        setSelectedBufferProfileId((current) => (current && profiles.some((profile) => profile.id === current) ? current : (defaultProfile?.id || '')));
      })
      .catch((error) => {
        console.error('Failed to fetch Buffer profiles', error);
        setBufferProfiles([]);
        setSelectedBufferProfileId('');
      });
  }, [activeWorkspaceId, token, onAuthFailure, bufferConnected]);

  useEffect(() => {
    setPromotionState({ status: 'idle', message: '' });
    setDraftState({ status: 'idle', message: '' });
    setWordpressState({ status: 'idle', message: '' });
    setLinkedinState({ status: 'idle', message: '' });
    setBufferState({ status: 'idle', message: '' });
    setHubspotState({ status: 'idle', message: '' });
    setAutomationRetryState({ status: 'idle', message: '' });
    setDraftComposer(null);

    if (!selectedTask?.artifact) {
      setSelectedLeadId('');
      return;
    }

    setSelectedLeadId((currentLeadId) => {
      if (currentLeadId !== '' && leads.some((lead) => lead.id === currentLeadId)) {
        return currentLeadId;
      }

      return leads[0]?.id ?? '';
    });
  }, [selectedTaskId, selectedTask?.artifact, leads]);

  useEffect(() => {
    if (!selectedTask?.artifact) {
      setSelectedMediaId(null);
      return;
    }

    if (typeof selectedTask.selectedMediaAssetId === 'number') {
      setSelectedMediaId(selectedTask.selectedMediaAssetId);
      return;
    }

    if (!selectedTask.artifact.imageUrl) {
      return;
    }

    const matchedMedia = socialMediaItems.find((item) => item.thumbnail === selectedTask.artifact?.imageUrl);
    if (matchedMedia) {
      setSelectedMediaId(matchedMedia.id);
    }
  }, [selectedTask?.id, selectedTask?.artifact, selectedTask?.selectedMediaAssetId, socialMediaItems]);

  useEffect(() => {
    if (!activeWorkspaceId || !token || !selectedTaskId) {
      setAutomationLogs([]);
      return;
    }

    apiFetch<TaskAutomationLogEntry[]>(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(selectedTaskId)}/automation-logs?limit=8`, {
      token,
      onAuthFailure,
    })
      .then((data) => setAutomationLogs(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.error('Failed to fetch task automation logs', error);
        setAutomationLogs([]);
      });
  }, [activeWorkspaceId, token, selectedTaskId, onAuthFailure]);

  const persistSelectedMedia = async (nextMediaId: number | null) => {
    if (!activeWorkspaceId || !token || !selectedTask) {
      return;
    }

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(selectedTask.id)}/selected-media`, {
        method: 'PATCH',
        token,
        onAuthFailure,
        body: JSON.stringify({ selectedMediaAssetId: nextMediaId }),
      });
    } catch (error) {
      console.error('Failed to persist task selected media', error);
    }
  };

  const handleSelectMedia = (nextMediaId: number | null) => {
    setSelectedMediaId(nextMediaId);
    void persistSelectedMedia(nextMediaId);
  };

  const counts = {
    all: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    running: tasks.filter(t => t.status === 'running').length,
    done: tasks.filter(t => t.status === 'done').length,
    failed: tasks.filter(t => Boolean(t.lastError)).length,
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateTask(newTask);
    setIsCreating(false);
    setNewTask({
      title: '',
      description: '',
      assigneeId: agents[0]?.id || '',
      dueDate: 'Tomorrow, 9:00 AM',
      repeat: ''
    });
  };

  const handlePromoteArtifact = async () => {
    if (!selectedTask?.artifact || !activeWorkspaceId || !token || selectedLeadId === '') {
      return;
    }

    setPromotionState({ status: 'saving', message: '' });

    try {
      const result = await apiFetch<{ notes: string }>(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(selectedTask.id)}/promote-artifact`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({ leadId: selectedLeadId }),
      });

      const updatedNotes = typeof result?.notes === 'string' ? result.notes : null;
      if (updatedNotes) {
        setLeads((currentLeads) => currentLeads.map((lead) => (
          lead.id === selectedLeadId ? { ...lead, notes: updatedNotes } : lead
        )));
      }

      const savedLead = leads.find((lead) => lead.id === selectedLeadId);
      setPromotionState({
        status: 'success',
        message: savedLead ? `Saved to ${savedLead.name}'s notes.` : 'Saved to lead notes.',
      });
    } catch (error) {
      console.error('Failed to promote task artifact', error);
      setPromotionState({
        status: 'error',
        message: 'Could not save this artifact to the selected lead.',
      });
    }
  };

  const handleCreateWordPressDraft = async () => {
    if (!selectedTask?.artifact || !activeWorkspaceId || !token) {
      return;
    }

    const payload = buildWordPressDraftPayload(selectedTask);
    if (!payload) {
      return;
    }

    setWordpressState({ status: 'saving', message: '' });

    try {
      const result = await apiFetch<{ link?: string | null }>(`/api/workspaces/${activeWorkspaceId}/integrations/wordpress/drafts`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify(payload),
      });

      setWordpressState({
        status: 'success',
        message: result?.link ? `WordPress draft created. ${result.link}` : 'WordPress draft created.',
      });
    } catch (error) {
      console.error('Failed to create WordPress draft', error);
      setWordpressState({
        status: 'error',
        message: 'Could not create the WordPress draft.',
      });
    }
  };

  const handlePublishToLinkedIn = async () => {
    if (!selectedTask?.artifact || !activeWorkspaceId || !token) {
      return;
    }

    const payload = buildSocialPostPayload(selectedTask, selectedMediaUrl);
    if (!payload) {
      return;
    }

    setLinkedinState({ status: 'saving', message: '' });

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin/post`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify(payload),
      });

      setLinkedinState({
        status: 'success',
        message: 'Published this artifact to LinkedIn.',
      });
    } catch (error) {
      console.error('Failed to publish LinkedIn post', error);
      setLinkedinState({
        status: 'error',
        message: 'Could not publish this artifact to LinkedIn.',
      });
    }
  };

  const handleQueueBufferPost = async () => {
    if (!selectedTask?.artifact || !activeWorkspaceId || !token || !selectedBufferProfileId) {
      return;
    }

    const payload = buildSocialPostPayload(selectedTask, selectedMediaUrl);
    if (!payload) {
      return;
    }

    setBufferState({ status: 'saving', message: '' });

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/buffer/updates`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({
          profileIds: [selectedBufferProfileId],
          text: payload.text,
          link: payload.link,
          imageUrl: payload.imageUrl,
          title: payload.title,
          description: payload.description,
        }),
      });

      const profile = bufferProfiles.find((entry) => entry.id === selectedBufferProfileId);
      setBufferState({
        status: 'success',
        message: profile
          ? `Queued this artifact in Buffer for ${profile.formattedUsername || profile.serviceUsername || profile.service}.`
          : 'Queued this artifact in Buffer.',
      });
    } catch (error) {
      console.error('Failed to queue Buffer update', error);
      setBufferState({
        status: 'error',
        message: 'Could not queue this artifact in Buffer.',
      });
    }
  };

  const handleSyncLeadToHubSpot = async () => {
    if (!activeWorkspaceId || !token || selectedLeadId === '' || !selectedLead?.email) {
      return;
    }

    const artifactNote = selectedTask?.artifact
      ? [
          selectedTask.artifact.title,
          selectedTask.artifact.body,
          ...selectedTask.artifact.bullets.map((bullet) => `- ${bullet}`),
        ].join('\n')
      : '';

    setHubspotState({ status: 'saving', message: '' });

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/hubspot/sync-lead`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({
          leadId: selectedLeadId,
          note: artifactNote,
          createDeal: Boolean(selectedTask?.artifact),
        }),
      });

      setHubspotState({
        status: 'success',
        message: `Synced ${selectedLead.name} to HubSpot.`,
      });
    } catch (error) {
      console.error('Failed to sync lead to HubSpot', error);
      setHubspotState({
        status: 'error',
        message: 'Could not sync the selected lead to HubSpot.',
      });
    }
  };

  const handleCreateDraft = async () => {
    if (!token || !draftComposer) {
      return;
    }

    setDraftState({ status: 'saving', message: '' });

    try {
      await apiFetch('/api/integrations/gmail/drafts', {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify(draftComposer),
      });

      setDraftState({
        status: 'success',
        message: `Draft created for ${draftComposer.to}.`,
      });
      setDraftComposer(null);
    } catch (error) {
      console.error('Failed to create Gmail draft from task artifact', error);
      setDraftState({
        status: 'error',
        message: gmailConnected
          ? 'Could not create the Gmail draft for this lead.'
          : 'Gmail is not connected for this workspace.',
      });
    }
  };

  const handleOpenDraftComposer = () => {
    if (!selectedTask || !selectedLead?.email) {
      return;
    }

    const nextDraft = buildArtifactDraftPayload(selectedTask, selectedLead);
    if (!nextDraft) {
      return;
    }

    setDraftState({ status: 'idle', message: '' });
    setDraftComposer(nextDraft);
  };

  const handleRetryAutomation = async () => {
    if (!activeWorkspaceId || !token || !selectedTask) {
      return;
    }

    setAutomationRetryState({ status: 'saving', message: '' });

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(selectedTask.id)}/automation-retry`, {
        method: 'POST',
        token,
        onAuthFailure,
      });

      const refreshedLogs = await apiFetch<TaskAutomationLogEntry[]>(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(selectedTask.id)}/automation-logs?limit=8`, {
        token,
        onAuthFailure,
      });
      setAutomationLogs(Array.isArray(refreshedLogs) ? refreshedLogs : []);

      setAutomationRetryState({
        status: 'success',
        message: 'Automation retry requested. Check logs below for channel outcomes.',
      });
    } catch (error) {
      console.error('Failed to retry task automation', error);
      setAutomationRetryState({
        status: 'error',
        message: 'Could not retry automation for this task.',
      });
    }
  };

  return (
    <div className="flex-1 flex bg-white overflow-hidden relative">
      {/* List View */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 md:px-8 py-6 md:py-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Tasks</h1>
              <p className="text-xs md:text-sm text-slate-500 mt-1">View all tasks created by your AI employees</p>
            </div>
            <button
              onClick={() => setIsCreating(true)}
              className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 flex-shrink-0"
            >
              <span className="hidden sm:inline">Create Task</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>

          <div className="flex gap-2 mt-6 overflow-x-auto no-scrollbar pb-1">
            {(['all', 'todo', 'running', 'done', 'failed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-[10px] md:text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap",
                  filter === f
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                )}
              >
                <span className="capitalize">{f.replace('_', ' ')}</span>
                <span className={cn(
                  "opacity-50",
                  filter === f ? "text-white" : "text-slate-400"
                )}>
                  {counts[f]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-8">
          <div className="flex flex-col">
            {filteredTasks.map((task) => {
              const agent = agents.find(a => a.id === task.assigneeId);
              const secondaryText = task.lastError || task.outputSummary || task.description;
              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className="w-full text-left py-6 border-b border-slate-100 transition-all group flex items-start gap-4 relative cursor-pointer hover:bg-slate-50/50"
                  style={{ minHeight: '110px' }}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {task.lastError ? <AlertCircle className="w-[20px] h-[20px] text-rose-500" /> : 
                     task.status === 'running' ? <LoaderCircle className="w-[20px] h-[20px] text-brand-500 animate-spin" /> : 
                     task.status === 'done' ? <CheckCircle2 className="w-[20px] h-[20px] text-[#10b981]" /> : 
                     <Circle className="w-[20px] h-[20px] text-blue-500" />}
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <h3 className={cn(
                      "text-[15px] font-bold text-slate-900 truncate",
                      task.status === 'done' && "text-slate-600 font-semibold"
                    )}>
                      {task.title}
                    </h3>
                    <p className={cn(
                      'text-[13px] mt-1.5 truncate',
                      task.lastError ? 'text-rose-500' : 'text-slate-400'
                    )}>
                      {secondaryText}
                    </p>
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-400">
                        <Calendar className="w-4 h-4" />
                        {task.dueDate}
                      </div>
                      <div className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
                        <div className="w-5 h-5 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                          <img src={agent?.avatar} alt={agent?.name} className="w-full h-full object-cover" />
                        </div>
                        <span className="font-medium truncate max-w-[100px] md:max-w-none">{agent?.name}</span>
                      </div>
                    </div>
                  </div>
                  {selectedTaskId === task.id && (
                    <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-[#d1d5db]" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedTaskId && selectedTask && (
          <>
            {/* Mobile Overlay for Detail Panel */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTaskId(null)}
              className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 w-full sm:w-[400px] md:relative md:w-[400px] border-l border-slate-100 bg-white shadow-2xl z-50 md:z-20 flex flex-col"
            >
              <div className="p-4 md:p-6 flex items-center justify-between border-b border-slate-50">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-slate-900">Details</h2>
                  <span className={cn(
                    'px-2 py-0.5 text-[10px] font-bold rounded-md flex items-center gap-1',
                    selectedTaskBadge?.className,
                  )}>
                    {getStatusIcon(selectedTask)}
                    {selectedTaskBadge?.label}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedTaskId(null)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight mb-6 md:mb-8">
                  {selectedTask.title}
                </h1>

                <div className="space-y-5 md:space-y-6">
                  <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Assignee
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                        <img src={assignee?.avatar} alt={assignee?.name} />
                      </div>
                      <span className="text-sm font-bold text-slate-700">{assignee?.name}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Due date
                    </span>
                    <span className="text-sm font-bold text-slate-700">{selectedTask.dueDate}</span>
                  </div>

                  {selectedTask.repeat && (
                    <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                      <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" />
                        Repeat
                      </span>
                      <span className="text-sm font-bold text-slate-700">{selectedTask.repeat}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Mode
                    </span>
                    <span className="text-sm font-bold text-slate-700">{formatExecutionType(selectedTask.executionType)}</span>
                  </div>

                  <div className="pt-6 border-t border-slate-50 space-y-4">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 uppercase tracking-[0.16em]">Execution</span>
                    <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                      <span className="text-[10px] md:text-xs font-medium text-slate-400">Last run</span>
                      <span className="text-sm font-bold text-slate-700">{formatTimestamp(selectedTask.lastRunAt)}</span>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                      <span className="text-[10px] md:text-xs font-medium text-slate-400">Started</span>
                      <span className="text-sm font-bold text-slate-700">{formatTimestamp(selectedTask.startedAt)}</span>
                    </div>
                    <div className="grid grid-cols-[80px_1fr] md:grid-cols-[100px_1fr] items-center gap-4">
                      <span className="text-[10px] md:text-xs font-medium text-slate-400">Completed</span>
                      <span className="text-sm font-bold text-slate-700">{formatTimestamp(selectedTask.completedAt)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2 mb-3">
                        <FileText className="w-4 h-4" />
                        Output summary
                      </span>
                      <p className="text-sm text-slate-500 leading-relaxed">
                        {selectedTask.outputSummary || 'No execution output recorded yet.'}
                      </p>
                    </div>
                    {selectedTask.lastError && (
                      <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                        <span className="text-[10px] md:text-xs font-medium text-rose-500 flex items-center gap-2 mb-2">
                          <AlertCircle className="w-4 h-4" />
                          Last error
                        </span>
                        <p className="text-sm text-rose-700 leading-relaxed">
                          {selectedTask.lastError}
                        </p>
                      </div>
                    )}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                      <span className="text-[10px] md:text-xs font-medium text-slate-400 uppercase tracking-[0.16em]">Automation logs</span>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-slate-500">Manual retry replays automation dispatch for the current artifact.</p>
                        {canRetryAutomation ? (
                          <button
                            type="button"
                            onClick={handleRetryAutomation}
                            disabled={!selectedTask.artifact || automationRetryState.status === 'saving'}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                          >
                            {automationRetryState.status === 'saving' ? 'Retrying...' : 'Retry automation'}
                          </button>
                        ) : null}
                      </div>
                      {automationRetryState.message && (
                        <p className={cn(
                          'text-xs font-medium',
                          automationRetryState.status === 'error' ? 'text-rose-600' : 'text-emerald-600',
                        )}>
                          {automationRetryState.message}
                        </p>
                      )}
                      {automationLogs.length === 0 ? (
                        <p className="text-sm text-slate-500">No automation events recorded for this task yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {automationLogs.map((log) => (
                            <div key={log.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                              <p className="text-xs font-bold text-slate-700">{log.action}</p>
                              <p className="text-[11px] text-slate-500 mt-1">
                                {log.details?.channel ? `${log.details.channel} · ` : ''}
                                {log.details?.reason || log.details?.error || 'Event recorded'}
                              </p>
                              {log.createdAt && (
                                <p className="text-[10px] text-slate-400 mt-1">{log.createdAt}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedTask.artifact && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                        <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          Artifact
                        </span>
                        <div>
                          <h3 className="text-sm font-bold text-slate-800">{selectedTask.artifact.title}</h3>
                          <p className="text-sm text-slate-600 leading-relaxed mt-2">{selectedTask.artifact.body}</p>
                        </div>
                        {selectedTask.artifact.imageUrl && (
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                            <img
                              src={selectedTask.artifact.imageUrl}
                              alt={selectedTask.artifact.title}
                              className="h-48 w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        {selectedTask.artifact.bullets.length > 0 && (
                          <ul className="space-y-2">
                            {selectedTask.artifact.bullets.map((bullet, index) => (
                              <li key={`${selectedTask.id}-artifact-${index}`} className="text-sm text-slate-600 flex gap-2">
                                <span className="text-brand-500 font-bold">•</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="pt-3 border-t border-slate-200 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <select
                              value={selectedLeadId}
                              onChange={(event) => setSelectedLeadId(event.target.value ? Number(event.target.value) : '')}
                              disabled={leads.length === 0 || promotionState.status === 'saving'}
                              className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              {leads.length === 0 ? (
                                <option value="">No leads available</option>
                              ) : (
                                leads.map((lead) => (
                                  <option key={lead.id} value={lead.id}>
                                    {lead.name}{lead.company ? ` - ${lead.company}` : ''}
                                  </option>
                                ))
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={handlePromoteArtifact}
                              disabled={leads.length === 0 || selectedLeadId === '' || promotionState.status === 'saving'}
                              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              {promotionState.status === 'saving' ? 'Saving...' : 'Save to Lead'}
                            </button>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              onClick={handleOpenDraftComposer}
                              disabled={!gmailConnected || !selectedLead?.email}
                              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              Review Gmail Draft
                            </button>
                            <p className="text-xs text-slate-500">
                              {selectedLead?.email
                                ? `Uses ${selectedLead.email} as the recipient.`
                                : 'Choose a lead with an email address to create a Gmail draft.'}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              onClick={handleCreateWordPressDraft}
                              disabled={!wordpressConnected || wordpressState.status === 'saving'}
                              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              {wordpressState.status === 'saving' ? 'Saving Draft...' : 'Create WordPress Draft'}
                            </button>
                            <p className="text-xs text-slate-500">
                              {wordpressConnected
                                ? 'Saves this artifact as a draft post in WordPress.'
                                : 'Connect WordPress in Settings to publish blog drafts.'}
                            </p>
                          </div>
                          {socialMediaItems.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <select
                                  value={selectedMediaId ?? ''}
                                  onChange={(event) => handleSelectMedia(event.target.value ? Number(event.target.value) : null)}
                                  disabled={linkedinState.status === 'saving' || bufferState.status === 'saving'}
                                  className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  <option value="">Use artifact/default image</option>
                                  {socialMediaItems.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                                {selectedMediaItem?.thumbnail && (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectMedia(null)}
                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all"
                                  >
                                    Clear Media
                                  </button>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">
                                Optional: select an image from Media to override the artifact image for LinkedIn and Buffer publishing.
                              </p>
                              {selectedMediaItem?.thumbnail && (
                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                  <img
                                    src={selectedMediaItem.thumbnail}
                                    alt={selectedMediaItem.name}
                                    className="h-32 w-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              onClick={handlePublishToLinkedIn}
                              disabled={!linkedinConnected || linkedinState.status === 'saving'}
                              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              {linkedinState.status === 'saving' ? 'Publishing...' : 'Publish to LinkedIn'}
                            </button>
                            <p className="text-xs text-slate-500">
                              {linkedinConnected
                                ? (selectedMediaUrl || selectedTask.artifact.imageUrl)
                                  ? 'Publishes this artifact as a LinkedIn post and uploads the attached image when supported.'
                                  : 'Publishes this artifact as a LinkedIn post for the connected member account.'
                                : 'Connect LinkedIn in Settings to publish artifact copy.'}
                            </p>
                          </div>
                          <div className="space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <select
                                value={selectedBufferProfileId}
                                onChange={(event) => setSelectedBufferProfileId(event.target.value)}
                                disabled={!bufferConnected || bufferProfiles.length === 0 || bufferState.status === 'saving'}
                                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                {bufferProfiles.length === 0 ? (
                                  <option value="">No Buffer profiles available</option>
                                ) : (
                                  bufferProfiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                      {profile.formattedUsername || profile.serviceUsername || `${profile.service} profile`}
                                    </option>
                                  ))
                                )}
                              </select>
                              <button
                                type="button"
                                onClick={handleQueueBufferPost}
                                disabled={!bufferConnected || !selectedBufferProfileId || bufferState.status === 'saving'}
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                              >
                                {bufferState.status === 'saving' ? 'Queueing...' : 'Queue in Buffer'}
                              </button>
                            </div>
                            <p className="text-xs text-slate-500">
                              {bufferConnected
                                ? (selectedMediaUrl || selectedTask.artifact.imageUrl)
                                  ? 'Queues this artifact to the selected Buffer profile and includes the attached image when it is a public image URL.'
                                  : 'Queues this artifact to the selected Buffer profile using the workspace connection.'
                                : 'Connect Buffer in Settings to queue social posts.'}
                            </p>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <button
                              type="button"
                              onClick={handleSyncLeadToHubSpot}
                              disabled={!hubspotConnected || !selectedLead?.email || hubspotState.status === 'saving'}
                              className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                              {hubspotState.status === 'saving' ? 'Syncing...' : 'Sync Lead to HubSpot'}
                            </button>
                            <p className="text-xs text-slate-500">
                              {selectedLead?.email
                                ? hubspotConnected
                                  ? 'Creates or updates a HubSpot contact and attaches this artifact as a note.'
                                  : 'Connect HubSpot in Settings to sync leads into your CRM.'
                                : 'Choose a lead with an email address to sync it to HubSpot.'}
                            </p>
                          </div>
                          {promotionState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              promotionState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {promotionState.message}
                            </p>
                          )}
                          {draftState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              draftState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {draftState.message}
                            </p>
                          )}
                          {wordpressState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              wordpressState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {wordpressState.message}
                            </p>
                          )}
                          {linkedinState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              linkedinState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {linkedinState.message}
                            </p>
                          )}
                          {bufferState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              bufferState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {bufferState.message}
                            </p>
                          )}
                          {hubspotState.message && (
                            <p className={cn(
                              'text-xs font-medium',
                              hubspotState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                            )}>
                              {hubspotState.message}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 border-t border-slate-50">
                    <span className="text-[10px] md:text-xs font-medium text-slate-400 flex items-center gap-2 mb-3 md:mb-4">
                      <FileText className="w-4 h-4" />
                      Description
                    </span>
                    <p className="text-sm text-slate-500 leading-relaxed">
                      {selectedTask.description}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 md:p-6 border-t border-slate-50 mt-auto">
                <button
                  disabled={selectedTask.status === 'running'}
                  onClick={() => onUpdateTask(selectedTask.id, selectedTask.status === 'done' ? 'todo' : 'done')}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {selectedTask.status === 'running'
                    ? 'Task is currently running'
                    : `Mark as ${selectedTask.status === 'done' ? 'To Do' : 'Done'}`}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Task Modal */}
      <AnimatePresence>
        {draftComposer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setDraftComposer(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-900">Review Gmail Draft</h2>
                  <p className="text-sm text-slate-500 mt-1">Edit the generated email before saving it to Gmail.</p>
                </div>
                <button
                  onClick={() => setDraftComposer(null)}
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 md:p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">To</label>
                  <input
                    value={draftComposer.to}
                    onChange={(event) => setDraftComposer((current) => current ? { ...current, to: event.target.value } : current)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Subject</label>
                  <input
                    value={draftComposer.subject}
                    onChange={(event) => setDraftComposer((current) => current ? { ...current, subject: event.target.value } : current)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Body</label>
                  <textarea
                    value={draftComposer.body}
                    onChange={(event) => setDraftComposer((current) => current ? { ...current, body: event.target.value } : current)}
                    rows={12}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm leading-relaxed focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all resize-none"
                  />
                </div>

                {draftState.message && (
                  <p className={cn(
                    'text-sm font-medium',
                    draftState.status === 'error' ? 'text-rose-600' : 'text-emerald-600'
                  )}>
                    {draftState.message}
                  </p>
                )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button
                  type="button"
                  onClick={() => setDraftComposer(null)}
                  className="flex-1 px-4 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateDraft}
                  disabled={draftState.status === 'saving' || !draftComposer.to.trim() || !draftComposer.subject.trim() || !draftComposer.body.trim()}
                  className="flex-1 px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {draftState.status === 'saving' ? 'Creating draft...' : 'Create Draft in Gmail'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isCreating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setIsCreating(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">Create New Task</h2>
                <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleCreateSubmit} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Title</label>
                  <input
                    required
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    placeholder="Task title"
                    value={newTask.title}
                    onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assignee</label>
                  <select
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    value={newTask.assigneeId}
                    onChange={e => setNewTask({ ...newTask, assigneeId: e.target.value })}
                  >
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name} ({agent.role})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Due Date</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="Tomorrow, 9:00 AM"
                      value={newTask.dueDate}
                      onChange={e => setNewTask({ ...newTask, dueDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Repeat</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="e.g. Every day"
                      value={newTask.repeat}
                      onChange={e => setNewTask({ ...newTask, repeat: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description</label>
                  <textarea
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all min-h-[100px]"
                    placeholder="What needs to be done?"
                    value={newTask.description}
                    onChange={e => setNewTask({ ...newTask, description: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-brand-600 text-white rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/25"
                >
                  Create Task
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const FileText: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);
