import React, { useState, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { TEAM_CHAT_AGENT_ID } from './constants';

// Display names for the hardcoded agent registry — used when a workspace has no
// custom agent profiles configured in the database.
const DEFAULT_AGENT_NAMES: Record<string, string> = {
  'executive-assistant': 'Eva (Executive Assistant)',
  'sales-associate': 'Stan (Sales Rep)',
  'blog-writer': 'Penny (SEO Blog Writer)',
  'social-media-manager': 'Sonny (Social Media Manager)',
  'receptionist': 'Rachel (Receptionist)',
  'legal-associate': 'Linda (Legal Assistant)',
  'team-chat': 'Team Chat',
};
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Users,
  CheckSquare,
  User as UserIcon,
  ChevronLeft,
  Menu,
  ClipboardCheck,
  Settings,
} from 'lucide-react';
import { Agent, AgentPersonality, AgentRole, AgentStatus, Message, Task, Workspace } from './types';
import { AgentCard } from './components/AgentCard';
import { ChatInterface } from './components/ChatInterface';
import { MediaLibrary } from './components/MediaLibrary';
import { CompanyKnowledge } from './components/CompanyKnowledge';
import { TeamManagement } from './components/TeamManagement';
import { TaskManager } from './components/TaskManager';
import { SettingsView } from './components/SettingsView';
import { ApprovalQueue } from './components/ApprovalQueue';
import { LoginView } from './components/LoginView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { getAgentResponse, parseTaskFromResponse, parseDraftEmailFromResponse, stripAgentJson, LiveContext, ConnectedServices } from './services/geminiService';
import { apiFetch } from './services/apiClient';
import { buildAgentPromptContext, cn, normalizeAgentPersonality } from './utils';

export default function App() {
  const [googleContextDefaults, setGoogleContextDefaults] = useState<{ analyticsPropertyId: string | null; searchConsoleSiteUrl: string | null }>({
    analyticsPropertyId: null,
    searchConsoleSiteUrl: null,
  });
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<'account' | 'integrations'>('account');

  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('sanford-user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('sanford-token');
  });
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(() => {
    const saved = localStorage.getItem('sanford-active-workspace');
    return saved ? parseInt(saved) : null;
  });

  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>('');
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [connectedServices, setConnectedServices] = useState<ConnectedServices>({});
  // Start loading=true if we already have a token (returning user)
  const [isLoading, setIsLoading] = useState(() => !!localStorage.getItem('sanford-token'));

  const [workingAgents, setWorkingAgents] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<'chat' | 'media' | 'docs' | 'team' | 'tasks' | 'settings' | 'approvals'>('chat');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAgentList, setShowAgentList] = useState(true);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [showWorkspacePrompt, setShowWorkspacePrompt] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');

  // ── Load workspace-specific data from backend ───────────────────────────
  useEffect(() => {
    if (!activeWorkspaceId || !token) return;

    setIsLoading(true);
    Promise.all([
      apiFetch(`/api/workspaces/${activeWorkspaceId}/agents`, { token, onAuthFailure: () => handleLogout() }),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks`, { token, onAuthFailure: () => handleLogout() }),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/messages`, { token, onAuthFailure: () => handleLogout() }),
    ]).then(([agentsData, tasksData, messagesData]) => {
      const agentsList: Agent[] = (agentsData || []).map((a: any) => ({
        ...a,
        status: AgentStatus.IDLE,
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
        guidelines: Array.isArray(a.guidelines) ? a.guidelines : [],
        personality: normalizeAgentPersonality(a.personality),
      }));
      setAgents(agentsList);
      if (agentsList.length > 0) {
        const firstVisible = agentsList.find(a => a.id !== TEAM_CHAT_AGENT_ID) || agentsList[0];
        const stillValid = agentsList.find(a => a.id === activeAgentId && a.id !== TEAM_CHAT_AGENT_ID);
        if (!stillValid) setActiveAgentId(firstVisible.id);
      }

      setTasks(tasksData || []);

      // Setup initial messages state
      setMessages({});


      // Reset view when switching workspace
      setActiveView('chat');
      setShowAgentList(true);
      setIsLoading(false);
    }).catch(err => {
      console.error('Failed to load workspace data', err);
      setIsLoading(false);
    });
  }, [activeWorkspaceId, token]);

  useEffect(() => {
    if (token) {
      setIsLoading(true);
      Promise.all([
        apiFetch('/api/workspaces', { token, onAuthFailure: () => handleLogout() }),
        apiFetch('/api/integrations/google/status', { token, onAuthFailure: () => handleLogout() }).catch(() => ({})),
      ]).then(([wsData, gsData]: [any, any]) => {
        setWorkspaces(wsData);
        if (wsData.length > 0) {
          const isValid = wsData.find((w: any) => w.id === activeWorkspaceId);
          if (!isValid) {
            setActiveWorkspaceId(wsData[0].id);
          }
        } else if (wsData.length === 0) {
          setIsLoading(false);
        }
        setConnectedServices({
          gmail: gsData?.gmail ?? false,
          calendar: gsData?.calendar ?? false,
          drive: gsData?.drive ?? false,
          slack: false,
          teams: false,
          notion: false,
          linkedin: false,
          buffer: false,
          twilio: false,
          analytics: gsData?.analytics ?? false,
          searchConsole: gsData?.searchConsole ?? false,
          wordpress: false,
          hubspot: false,
        });
      }).catch(err => {
        console.error('Failed to fetch workspaces', err);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    Promise.all([
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/slack/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/teams/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/notion/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/linkedin/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/buffer/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false, profiles: [] })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/twilio/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/wordpress/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/hubspot/status`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ connected: false })),
      apiFetch(`/api/workspaces/${activeWorkspaceId}/integrations/google/defaults`, { token, onAuthFailure: () => handleLogout() }).catch(() => ({ analyticsPropertyId: null, searchConsoleSiteUrl: null })),
    ]).then(([slackData, teamsData, notionData, linkedinData, bufferData, twilioData, wordpressData, hubspotData, googleDefaultsData]: [any, any, any, any, any, any, any, any, any]) => {
      setConnectedServices((current) => ({
        ...current,
        slack: slackData?.connected ?? false,
        teams: teamsData?.connected ?? false,
        notion: notionData?.connected ?? false,
        linkedin: linkedinData?.connected ?? false,
        buffer: bufferData?.connected ?? false,
        twilio: twilioData?.connected ?? false,
        wordpress: wordpressData?.connected ?? false,
        hubspot: hubspotData?.connected ?? false,
      }));
      setGoogleContextDefaults({
        analyticsPropertyId: googleDefaultsData?.analyticsPropertyId ?? null,
        searchConsoleSiteUrl: googleDefaultsData?.searchConsoleSiteUrl ?? null,
      });
    }).catch((err) => {
      console.error('Failed to fetch workspace integration status', err);
    });
  }, [token, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem('sanford-active-workspace', activeWorkspaceId.toString());
    }
  }, [activeWorkspaceId]);

  // Poll for pending approvals every 60s
  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    const fetchApprovals = () => {
      apiFetch(`/api/workspaces/${activeWorkspaceId}/approvals?status=pending&limit=50`, {
        token,
        onAuthFailure: () => handleLogout(),
      })
        .then((data: any) => setPendingApprovals(Array.isArray(data) ? data : []))
        .catch(() => {});
    };

    fetchApprovals();
    const interval = setInterval(fetchApprovals, 60000);
    return () => clearInterval(interval);
  }, [token, activeWorkspaceId]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('sanford-user', JSON.stringify(user));
    } else {
      localStorage.removeItem('sanford-user');
    }
  }, [user]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('sanford-token', token);
    } else {
      localStorage.removeItem('sanford-token');
    }
  }, [token]);

  const handleLogin = (userData: any, authToken: string) => {
    setUser(userData);
    setToken(authToken);
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    setActiveView('chat');
  };

  const activeAgent = agents.find(a => a.id === activeAgentId) || agents[0];

  // Fetch thread history from LangGraph checkpointer whenever active channel changes
  useEffect(() => {
    if (!user || !activeAgentId || !token || !activeWorkspaceId) return;

    const threadId = activeAgentId === 'global' ? `thread_${user.id}_global` : `thread_${user.id}_${activeAgentId}`;
    
    apiFetch(`/api/workspaces/${activeWorkspaceId}/chat/history?threadId=${threadId}`, {
      token,
      onAuthFailure: () => handleLogout()
    }).then((data: any) => {
      if (data && data.messages) {
        const historyMessages: Message[] = data.messages.map((m: any, i: number) => ({
          id: `hist_${i}`,
          senderId: m.role === 'user' ? 'user' : m.sender,
          senderName: m.role === 'user' ? user.name : (agents.find(a => a.id === m.sender || a.id.startsWith(m.sender + ':'))?.name || DEFAULT_AGENT_NAMES[m.sender] || 'System'),
          senderAvatar: m.role === 'user' ? (user?.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user.email}`) : (agents.find(a => a.id === m.sender || a.id.startsWith(m.sender + ':'))?.avatar || `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${m.sender}`),
          content: m.content,
          timestamp: Date.now(),
          type: m.role === 'user' ? 'user' : 'agent'
        }));
        setMessages(prev => ({ ...prev, [activeAgentId]: historyMessages }));
      }
    }).catch(err => console.error("Failed to fetch history", err));
  }, [activeAgentId, activeWorkspaceId, token, user, agents]);


  // ── All hooks must be declared before any early returns ───────────────────
  const updateAgentStatus = useCallback((id: string, status: AgentStatus) => {
    setAgents(prev => prev.map(a =>
      a.id === id ? { ...a, status } : a
    ));
  }, []);

  const handleTaskCreation = useCallback((taskData: Omit<Task, 'id' | 'status'>) => {
    const newTask: Task = {
      ...taskData,
      id: Math.random().toString(36).substr(2, 9),
      status: 'todo'
    };
    setTasks(prev => [newTask, ...prev]);
    if (activeWorkspaceId) {
      apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks`, {
        method: 'POST',
        token,
        onAuthFailure: () => handleLogout(),
        body: JSON.stringify({
          title: taskData.title,
          description: taskData.description,
          assigneeId: taskData.assigneeId,
          dueDate: taskData.dueDate,
          repeat: taskData.repeat,
        }),
      }).then((saved: any) => {
        setTasks(prev => prev.map(t => t.id === newTask.id ? { ...t, id: saved.id } : t));
      }).catch(err => console.error('Failed to save task', err));
    }
    return newTask;
  }, [activeWorkspaceId, token]);

  const handleUpdateInstructions = useCallback(async (agentId: string, instructions: string) => {
    let previousInstructions = '';
    setAgents(prev => prev.map(a =>
      a.id === agentId
        ? (() => {
            previousInstructions = a.instructions;
            return { ...a, instructions };
          })()
        : a
    ));

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        token,
        onAuthFailure: () => handleLogout(),
        body: JSON.stringify({ instructions }),
      });
      return true;
    } catch (err) {
      console.error('Failed to save instructions', err);
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, instructions: previousInstructions } : a
      ));
      return false;
    }
  }, [activeWorkspaceId, token]);

  const handleUpdateAgentName = useCallback(async (agentId: string, name: string) => {
    let previousName = '';
    setAgents(prev => prev.map(a =>
      a.id === agentId
        ? (() => {
            previousName = a.name;
            return { ...a, name };
          })()
        : a
    ));

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        token,
        onAuthFailure: () => handleLogout(),
        body: JSON.stringify({ name }),
      });
      return true;
    } catch (err) {
      console.error('Failed to save agent name', err);
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, name: previousName } : a
      ));
      return false;
    }
  }, [activeWorkspaceId, token]);

  const handleUpdateCapabilities = useCallback(async (agentId: string, capabilities: string[]) => {
    let previousCapabilities: string[] = [];
    setAgents(prev => prev.map(a =>
      a.id === agentId
        ? (() => {
            previousCapabilities = a.capabilities;
            return { ...a, capabilities };
          })()
        : a
    ));
    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        token,
        onAuthFailure: () => handleLogout(),
        body: JSON.stringify({ capabilities }),
      });
      return true;
    } catch (err) {
      console.error('Failed to save capabilities', err);
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, capabilities: previousCapabilities } : a
      ));
      return false;
    }
  }, [activeWorkspaceId, token]);

  const handleUpdatePersonality = useCallback(async (agentId: string, personality: AgentPersonality) => {
    let previousPersonality: AgentPersonality | undefined;
    const normalized = normalizeAgentPersonality(personality);
    const fingerprint = JSON.stringify(normalized);
    const hasDuplicate = agents.some((agent) => agent.id !== agentId && JSON.stringify(normalizeAgentPersonality(agent.personality)) === fingerprint);

    if (hasDuplicate) {
      return false;
    }

    setAgents(prev => prev.map(a =>
      a.id === agentId
        ? (() => {
            previousPersonality = a.personality;
            return { ...a, personality: normalized };
          })()
        : a
    ));

    try {
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        token,
        onAuthFailure: () => handleLogout(),
        body: JSON.stringify({ personality: normalized }),
      });
      return true;
    } catch (err) {
      console.error('Failed to save personality', err);
      setAgents(prev => prev.map(a =>
        a.id === agentId ? { ...a, personality: previousPersonality } : a
      ));
      return false;
    }
  }, [activeWorkspaceId, token, agents]);

  const persistMessage = useCallback((msg: Message, agentId: string) => {
    if (!activeWorkspaceId) return;
    apiFetch(`/api/workspaces/${activeWorkspaceId}/messages`, {
      method: 'POST',
      token,
      onAuthFailure: () => handleLogout(),
      body: JSON.stringify({
        agentId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderAvatar: msg.senderAvatar,
        content: msg.content,
        imageUrl: msg.imageUrl ?? null,
        timestamp: msg.timestamp,
        type: msg.type,
      }),
    }).catch(err => console.error('Failed to persist message', err));
  }, [activeWorkspaceId, token]);

  // Auto-fetch real Gmail/Calendar/Drive context for Eva based on what the user asked about
  const fetchLiveContext = useCallback(async (message: string): Promise<LiveContext | undefined> => {
    if (!token) return undefined;
    const lower = message.toLowerCase();
    const wantsEmail = /email|inbox|mail|message|unread|reply|respond|draft|send/i.test(lower);
    const wantsCalendar = /schedul|calendar|meeting|event|appointment|today|tomorrow|week/i.test(lower);
    const wantsDrive = /drive|doc|file|document|slide|sheet|folder/i.test(lower);
    const wantsAnalytics = /analytics|traffic|sessions|users|page ?views|conversion|ga4|funnel|performance report/i.test(lower);
    const wantsSearchConsole = /search console|seo|query|queries|keyword|impression|click ?through|ctr|ranking|position/i.test(lower);

    if (!wantsEmail && !wantsCalendar && !wantsDrive && !wantsAnalytics && !wantsSearchConsole) return undefined;

    const ctx: LiveContext = {};

    try {
      const [emailRes, calRes, driveRes, analyticsPropsRes, searchSitesRes] = await Promise.allSettled([
        wantsEmail ? apiFetch('/api/integrations/gmail/messages?maxResults=10', { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null) : Promise.resolve(null),
        wantsCalendar ? apiFetch('/api/integrations/calendar/events?days=7', { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null) : Promise.resolve(null),
        wantsDrive ? apiFetch('/api/integrations/drive/files?maxResults=15', { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null) : Promise.resolve(null),
        wantsAnalytics ? apiFetch('/api/integrations/analytics/properties', { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null) : Promise.resolve(null),
        wantsSearchConsole ? apiFetch('/api/integrations/search-console/sites', { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null) : Promise.resolve(null),
      ]);
      if (emailRes.status === 'fulfilled' && emailRes.value?.messages) ctx.emails = emailRes.value.messages;
      if (calRes.status === 'fulfilled' && calRes.value?.events) ctx.events = calRes.value.events;
      if (driveRes.status === 'fulfilled' && driveRes.value?.files) ctx.files = driveRes.value.files;

      const availableProperties = analyticsPropsRes.status === 'fulfilled' ? (analyticsPropsRes.value?.properties || []) : [];
      const availableSites = searchSitesRes.status === 'fulfilled' ? (searchSitesRes.value?.sites || []) : [];

      const propertyId = (
        (googleContextDefaults.analyticsPropertyId && availableProperties.find((p: any) => p.propertyId === googleContextDefaults.analyticsPropertyId)?.propertyId) ||
        availableProperties[0]?.propertyId
      );
      const siteUrl = (
        (googleContextDefaults.searchConsoleSiteUrl && availableSites.find((s: any) => s.siteUrl === googleContextDefaults.searchConsoleSiteUrl)?.siteUrl) ||
        availableSites[0]?.siteUrl
      );

      const [analyticsReportRes, searchConsoleReportRes] = await Promise.allSettled([
        wantsAnalytics && propertyId
          ? apiFetch(`/api/integrations/analytics/report?propertyId=${encodeURIComponent(propertyId)}&days=28`, { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null)
          : Promise.resolve(null),
        wantsSearchConsole && siteUrl
          ? apiFetch(`/api/integrations/search-console/performance?siteUrl=${encodeURIComponent(siteUrl)}&days=28`, { token, onAuthFailure: () => handleLogout(), timeoutMs: 8000 }).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (analyticsReportRes.status === 'fulfilled' && analyticsReportRes.value?.rows) ctx.analyticsRows = analyticsReportRes.value.rows;
      if (searchConsoleReportRes.status === 'fulfilled' && searchConsoleReportRes.value?.rows) ctx.searchConsoleRows = searchConsoleReportRes.value.rows;
    } catch { /* ignore — non-connected services return 403 gracefully */ }

    return (ctx.emails || ctx.events || ctx.files || ctx.analyticsRows || ctx.searchConsoleRows) ? ctx : undefined;
  }, [token, googleContextDefaults.analyticsPropertyId, googleContextDefaults.searchConsoleSiteUrl]);

  // ── Early returns (after all hooks) ───────────────────────────────────────
  if (!user || !token) {
    return <LoginView onLogin={handleLogin} />;
  }

  // Show a loading spinner while fetching workspace data from the backend
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-warm-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-stone-400 font-medium">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) || null;




  const handleSendMessage = async (content: string) => {
    if (!user) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'user',
      senderName: user.name,
      senderAvatar: user?.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user.email}`,
      content,
      timestamp: Date.now(),
      type: 'user'
    };

    setMessages(prev => ({
      ...prev,
      [activeAgentId]: [...(prev[activeAgentId] || []), newMessage]
    }));

    const targetAgentId = activeAgentId;

    setWorkingAgents(prev => {
      const next = new Set(prev);
      next.add(targetAgentId);
      return next;
    });
    updateAgentStatus(targetAgentId, AgentStatus.THINKING);

    const threadId = targetAgentId === 'global' ? `thread_${user.id}_global` : `thread_${user.id}_${targetAgentId}`;
    const payloadMessage = targetAgentId === 'global' ? content : `[Direct message to ${targetAgentId}] ${content}`;
    
    const liveCtx = await fetchLiveContext(content);
      
    const { text, sender } = await getAgentResponse(
      payloadMessage,
      threadId,
      liveCtx || undefined,
      connectedServices,
      token,
      activeWorkspaceId,
      handleLogout
    );

    const agentResponse: Message = {
      id: (Date.now() + 1).toString(),
      senderId: sender || 'system',
      senderName: agents.find(a => a.id === sender || (sender && a.id.startsWith(sender + ':')))?.name || DEFAULT_AGENT_NAMES[sender || ''] || 'System',
      senderAvatar: agents.find(a => a.id === sender || (sender && a.id.startsWith(sender + ':')))?.avatar || 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=system',
      content: stripAgentJson(text),
      timestamp: Date.now(),
      type: 'agent'
    };

    setMessages(prev => ({
      ...prev,
      [targetAgentId]: [...(prev[targetAgentId] || []), agentResponse]
    }));

    setWorkingAgents(prev => {
      const next = new Set(prev);
      next.delete(targetAgentId);
      return next;
    });
    updateAgentStatus(targetAgentId, AgentStatus.IDLE);
  };


  if (activeWorkspace && !activeWorkspace.is_onboarded) {
    return (
      <div className="flex relative h-[100dvh] bg-white overflow-hidden text-stone-800">
        <Toaster 
          position="top-center" 
          toastOptions={{
            style: { background: '#1e293b', color: '#fff', borderRadius: '12px' },
            success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          }}
        />
        <OnboardingWizard
          token={token!}
          activeWorkspaceId={activeWorkspaceId!}
          onAuthFailure={handleLogout}
          onComplete={() => {
            window.location.reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex relative h-[100dvh] bg-warm-50 overflow-hidden text-stone-800">
      <Toaster
        position="top-center" 
        toastOptions={{
          style: {
            background: '#1e293b',
            color: '#fff',
            borderRadius: '12px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
        }}
      />
      {/* Mobile Sidebar Overlay */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-warm-100 border-b border-warm-200 z-40 flex items-center justify-between px-4">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-stone-500"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="font-display font-bold text-stone-900">Sanford AI</div>
        <div className="w-10 h-10 rounded-full bg-warm-100 overflow-hidden border border-warm-200">
          <img src={user?.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user?.email}`} alt="User" />
        </div>
      </div>

      {/* Sidebar Rail */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-[72px] bg-warm-100 border-r border-warm-200 flex flex-col items-center py-6 gap-8 transition-transform md:relative md:translate-x-0",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="w-10 h-10 flex items-center justify-center">
          <img src={activeWorkspace?.logo || "https://api.marblism.com/favicon.ico"} alt="Logo" className="w-8 h-8 opacity-80" />
        </div>

        {/* Workspace Switcher */}
        <div className="flex flex-col gap-3">
          {workspaces.map(ws => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspaceId(ws.id)}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all border-2",
                activeWorkspaceId === ws.id
                  ? "bg-brand-500 text-white border-brand-500 shadow-lg shadow-brand-500/20"
                  : "bg-warm-50 text-stone-400 border-warm-200 hover:border-warm-300"
              )}
              title={ws.name}
            >
              {ws.name.substring(0, 2).toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => {
              setWorkspaceNameDraft('');
              setShowWorkspacePrompt(true);
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-warm-50 text-stone-400 border-2 border-dashed border-warm-200 hover:border-warm-300 hover:text-stone-600 transition-all"
            title="Add Workspace"
          >
            +
          </button>
        </div>

        <nav className="flex flex-col gap-6">
          {[
            { id: 'chat', icon: MessageSquare },
            { id: 'docs', icon: FileText },
            { id: 'media', icon: ImageIcon },
            { id: 'team', icon: Users },
            { id: 'tasks', icon: CheckSquare },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                if (['chat', 'media', 'docs', 'team', 'tasks'].includes(item.id)) {
                  setActiveView(item.id as any);
                  setIsMobileMenuOpen(false);
                  if (item.id !== 'chat') setShowAgentList(false);
                }
              }}
              className={cn(
                "p-2 rounded-lg transition-colors relative group",
                activeView === item.id ? "text-stone-900 bg-warm-100" : "text-stone-400 hover:text-stone-600"
              )}
              title={item.id.charAt(0).toUpperCase() + item.id.slice(1)}
            >
              {activeView === item.id && (
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-500 rounded-r-full" />
              )}
              <item.icon className="w-6 h-6" />
            </button>
          ))}
          {/* Approvals button with badge */}
          <button
            onClick={() => {
              setActiveView('approvals');
              setIsMobileMenuOpen(false);
              setShowAgentList(false);
            }}
            className={cn(
              "p-2 rounded-lg transition-colors relative group",
              activeView === 'approvals' ? "text-stone-900 bg-warm-100" : "text-stone-400 hover:text-stone-600"
            )}
            title="Approvals"
          >
            {activeView === 'approvals' && (
              <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-500 rounded-r-full" />
            )}
            <ClipboardCheck className="w-6 h-6" />
            {pendingApprovals.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {pendingApprovals.length > 9 ? '9+' : pendingApprovals.length}
              </span>
            )}
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-6">
          <button
            onClick={() => {
              setActiveView('settings');
              setSettingsDefaultTab('account');
              setIsMobileMenuOpen(false);
            }}
            className={cn(
              "w-10 h-10 rounded-full bg-warm-100 overflow-hidden border-2 transition-all",
              activeView === 'settings' ? "border-brand-500 scale-110" : "border-warm-200 hover:border-warm-300"
            )}
          >
            <img src={user?.avatar || `https://api.dicebear.com/9.x/avataaars/svg?seed=${user?.email}`} alt="User" />
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Agent List Column */}
      <aside className={cn(
        "fixed inset-y-0 left-0 md:relative z-30 w-full md:w-[340px] border-r border-warm-200 flex flex-col bg-warm-50 transition-transform md:translate-x-0",
        showAgentList ? "translate-x-0" : "-translate-x-full",
        "pt-16 md:pt-0"
      )}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-stone-900">Agents</h1>
          <button
            className="md:hidden p-2 text-stone-400"
            onClick={() => setShowAgentList(false)}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">

          {agents.filter(a => a.id !== TEAM_CHAT_AGENT_ID).map((agent) => {
            const agentMessages = messages[agent.id] || [];
            const lastAgentMessage = [...agentMessages].reverse().find(m => m.type === 'agent');

            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                isActive={activeAgentId === agent.id}
                lastMessage={lastAgentMessage ? {
                  content: lastAgentMessage.content,
                  timestamp: lastAgentMessage.timestamp,
                  senderName: lastAgentMessage.senderName
                } : undefined}
                onClick={() => {
                  setActiveAgentId(agent.id);
                  setActiveView('chat');
                  setShowAgentList(false);
                }}
              />
            );
          })}
        </div>


      </aside>

      {/* Main Area */}
      <main className={cn(
        "flex-1 min-w-0 flex flex-col bg-warm-50 pt-16 md:pt-0 transition-transform",
        !showAgentList ? "translate-x-0" : "translate-x-full md:translate-x-0"
      )}>
        {activeView === 'chat' ? (
          activeAgent ? (
            <ChatInterface
              agent={activeAgent}
              messages={messages[activeAgentId] || []}
              token={token}
              activeWorkspaceId={activeWorkspaceId}
              onAuthFailure={handleLogout}
              onSendMessage={handleSendMessage}
              isTyping={workingAgents.has(activeAgentId)}
              onUpdateInstructions={handleUpdateInstructions}
              onUpdateCapabilities={handleUpdateCapabilities}
              onUpdatePersonality={handleUpdatePersonality}
              onUpdateName={handleUpdateAgentName}
              onBack={() => setShowAgentList(true)}
              onManageAccounts={() => {
                setSettingsDefaultTab('integrations');
                setActiveView('settings');
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center px-6">
              <div className="max-w-md text-center">
                <h2 className="font-display text-2xl font-bold text-stone-900">No agents in this workspace yet</h2>
                <p className="mt-2 text-stone-500">Create an agent from Team view or switch to a workspace that already has agents.</p>
                <button
                  onClick={() => setActiveView('team')}
                  className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 transition-colors"
                >
                  Open Team View
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="md:hidden px-6 py-4 border-b border-warm-200 flex items-center gap-4">
              <button onClick={() => setShowAgentList(true)} className="p-2 -ml-2 text-stone-400">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h2 className="font-display font-bold text-stone-900 capitalize">{activeView}</h2>
            </div>
            {activeView === 'approvals' ? (
              <ApprovalQueue
                workspaceId={activeWorkspaceId!}
                token={token}
                approvals={pendingApprovals}
                onApprovalChange={() => {
                  if (activeWorkspaceId && token) {
                    apiFetch(`/api/workspaces/${activeWorkspaceId}/approvals?status=pending&limit=50`, {
                      token,
                      onAuthFailure: () => handleLogout(),
                    })
                      .then((data: any) => setPendingApprovals(Array.isArray(data) ? data : []))
                      .catch(() => {});
                  }
                }}
                onAuthFailure={handleLogout}
              />
            ) : activeView === 'media' ? (
              <MediaLibrary activeWorkspaceId={activeWorkspaceId} token={token} onAuthFailure={() => handleLogout()} />
            ) : activeView === 'docs' ? (
              <CompanyKnowledge 
                activeWorkspaceId={activeWorkspaceId} 
                workspace={activeWorkspace}
                token={token}
                onAuthFailure={() => handleLogout()}
                onLogoUpdate={(logo) => {
                  setWorkspaces(prev => prev.map(w => w.id === activeWorkspaceId ? { ...w, logo } : w));
                }}
              />
            ) : activeView === 'team' ? (
              <TeamManagement activeWorkspaceId={activeWorkspaceId} token={token} onAuthFailure={handleLogout} />
            ) : activeView === 'settings' ? (
              <SettingsView
                user={user}
                token={token}
                activeWorkspaceId={activeWorkspaceId}
                activeWorkspaceRole={activeWorkspace?.role}
                onLogout={handleLogout}
                onConnectedServicesChange={setConnectedServices}
                onGoogleDefaultsChange={setGoogleContextDefaults}
                onUserUpdate={(updatedUser) => setUser(updatedUser)}
                defaultTab={settingsDefaultTab}
              />
            ) : (
              <TaskManager
                tasks={tasks}
                agents={agents}
                token={token}
                activeWorkspaceId={activeWorkspaceId}
                workspaceRole={activeWorkspace?.role ?? null}
                gmailConnected={connectedServices.gmail}
                linkedinConnected={connectedServices.linkedin}
                bufferConnected={connectedServices.buffer}
                wordpressConnected={connectedServices.wordpress}
                hubspotConnected={connectedServices.hubspot}
                onAuthFailure={handleLogout}
                onUpdateTask={(id, status) => {
                  setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
                  if (activeWorkspaceId) {
                    apiFetch(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(id)}`, {
                      method: 'PATCH',
                      token,
                      onAuthFailure: () => handleLogout(),
                      body: JSON.stringify({ status }),
                    }).catch(err => console.error('Failed to update task status', err));
                  }
                }}
                onCreateTask={handleTaskCreation}
              />
            )}
          </div>
        )}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-warm-100 border-t border-warm-200 z-40 flex items-center justify-around px-2">
        {[
          { id: 'chat', icon: MessageSquare, label: 'Chat' },
          { id: 'tasks', icon: CheckSquare, label: 'Tasks' },
          { id: 'docs', icon: FileText, label: 'Files' },
          { id: 'settings', icon: Settings, label: 'Settings' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => { setActiveView(item.id as any); if (item.id !== 'chat') setShowAgentList(false); }}
            className={cn(
              "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-colors",
              activeView === item.id ? "text-brand-600" : "text-stone-400"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {showWorkspacePrompt && (
        <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl md:rounded-3xl p-6 md:p-8 shadow-xl max-w-md w-full relative">
            <button onClick={() => setShowWorkspacePrompt(false)} className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-600 hover:bg-warm-100 rounded-full transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <h3 className="font-display text-xl font-bold text-stone-900 mb-2">Create Workspace</h3>
            <p className="text-stone-500 text-sm mb-6">Enter a name for your new workspace.</p>
            <input
              type="text"
              autoFocus
              value={workspaceNameDraft}
              onChange={(e) => setWorkspaceNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && workspaceNameDraft.trim() && token) {
                  apiFetch('/api/workspaces', {
                    method: 'POST',
                    token,
                    onAuthFailure: () => handleLogout(),
                    body: JSON.stringify({ name: workspaceNameDraft.trim() })
                  }).then(newWs => {
                    setWorkspaces(prev => [...prev, newWs]);
                    setActiveWorkspaceId(newWs.id);
                    setShowWorkspacePrompt(false);
                  });
                }
              }}
              placeholder="e.g. Acme Corp"
              className="w-full px-4 py-3 bg-warm-50 border border-warm-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all"
            />
            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={() => setShowWorkspacePrompt(false)}
                className="flex-1 px-5 py-2.5 font-bold text-stone-600 hover:bg-warm-100 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (workspaceNameDraft.trim() && token) {
                    apiFetch('/api/workspaces', {
                      method: 'POST',
                      token,
                      onAuthFailure: () => handleLogout(),
                      body: JSON.stringify({ name: workspaceNameDraft.trim() })
                    }).then(newWs => {
                      setWorkspaces(prev => [...prev, newWs]);
                      setActiveWorkspaceId(newWs.id);
                      setShowWorkspacePrompt(false);
                    });
                  }
                }}
                disabled={!workspaceNameDraft.trim()}
                className="flex-1 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-brand-300 text-white font-bold rounded-xl shadow-md shadow-brand-500/20 transition-all"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
