import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Users,
  CheckSquare,
  User as UserIcon,
  ChevronLeft,
  Menu
} from 'lucide-react';
import { Agent, AgentRole, AgentStatus, Message, Task, Workspace } from './types';
import { AgentCard } from './components/AgentCard';
import { ChatInterface } from './components/ChatInterface';
import { MediaLibrary } from './components/MediaLibrary';
import { CompanyKnowledge } from './components/CompanyKnowledge';
import { TeamManagement } from './components/TeamManagement';
import { TaskManager } from './components/TaskManager';
import { SettingsView } from './components/SettingsView';
import { LoginView } from './components/LoginView';
import { getAgentResponse, parseTaskFromResponse, parseDraftEmailFromResponse, stripAgentJson, LiveContext, ConnectedServices } from './services/geminiService';
import { cn } from './utils';

export default function App() {
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

  const [isTyping, setIsTyping] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'media' | 'docs' | 'team' | 'tasks' | 'settings'>('chat');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAgentList, setShowAgentList] = useState(true);

  // ── Load workspace-specific data from backend ───────────────────────────
  useEffect(() => {
    if (!activeWorkspaceId || !token) return;

    setIsLoading(true);
    const headers = { 'Authorization': `Bearer ${token}` };

    Promise.all([
      fetch(`/api/workspaces/${activeWorkspaceId}/agents`, { headers }).then(r => r.json()),
      fetch(`/api/workspaces/${activeWorkspaceId}/tasks`, { headers: {} }).then(r => r.json()),
      fetch(`/api/workspaces/${activeWorkspaceId}/messages`, { headers: {} }).then(r => r.json()),
    ]).then(([agentsData, tasksData, messagesData]) => {
      const agentsList: Agent[] = (agentsData || []).map((a: any) => ({
        ...a,
        status: AgentStatus.IDLE,
        capabilities: Array.isArray(a.capabilities) ? a.capabilities : [],
        guidelines: Array.isArray(a.guidelines) ? a.guidelines : [],
      }));
      setAgents(agentsList);
      if (agentsList.length > 0 && !activeAgentId) {
        setActiveAgentId(agentsList[0].id);
      } else if (agentsList.length > 0) {
        // keep active agent valid after workspace switch
        const stillValid = agentsList.find(a => a.id === activeAgentId);
        if (!stillValid) setActiveAgentId(agentsList[0].id);
      }

      setTasks(tasksData || []);

      // Group messages by agentId
      const grouped: Record<string, Message[]> = {};
      for (const m of (messagesData || [])) {
        const key = m.agentId;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          id: m.id,
          senderId: m.senderId,
          senderName: m.senderName,
          senderAvatar: m.senderAvatar,
          content: m.content,
          imageUrl: m.imageUrl,
          timestamp: m.timestamp,
          type: m.type,
        });
      }
      setMessages(grouped);

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
      const headers = { 'Authorization': `Bearer ${token}` };
      Promise.all([
        fetch('/api/workspaces', { headers }).then(r => r.json()),
        fetch('/api/integrations/google/status', { headers }).then(r => r.ok ? r.json() : {}),
      ]).then(([wsData, gsData]: [any, any]) => {
        setWorkspaces(wsData);
        if (wsData.length > 0 && !activeWorkspaceId) {
          setActiveWorkspaceId(wsData[0].id);
        } else if (wsData.length === 0) {
          setIsLoading(false);
        }
        setConnectedServices({
          gmail: gsData?.gmail ?? false,
          calendar: gsData?.calendar ?? false,
          drive: gsData?.drive ?? false,
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
    if (activeWorkspaceId) {
      localStorage.setItem('sanford-active-workspace', activeWorkspaceId.toString());
    }
  }, [activeWorkspaceId]);

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
      fetch(`/api/workspaces/${activeWorkspaceId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskData.title,
          description: taskData.description,
          assigneeId: taskData.assigneeId,
          dueDate: taskData.dueDate,
          repeat: taskData.repeat,
        }),
      }).then(r => r.json()).then(saved => {
        setTasks(prev => prev.map(t => t.id === newTask.id ? { ...t, id: saved.id } : t));
      }).catch(err => console.error('Failed to save task', err));
    }
    return newTask;
  }, [activeWorkspaceId]);

  const handleUpdateGuidelines = useCallback((agentId: string, guidelines: any[]) => {
    setAgents(prev => prev.map(a =>
      a.id === agentId ? { ...a, guidelines } : a
    ));
    fetch(`/api/workspaces/${activeWorkspaceId}/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guidelines }),
    }).catch(err => console.error('Failed to save guidelines', err));
  }, [activeWorkspaceId]);

  const persistMessage = useCallback((msg: Message, agentId: string) => {
    if (!activeWorkspaceId) return;
    fetch(`/api/workspaces/${activeWorkspaceId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  }, [activeWorkspaceId]);

  // Auto-fetch real Gmail/Calendar/Drive context for Eva based on what the user asked about
  const fetchLiveContext = useCallback(async (message: string): Promise<LiveContext | undefined> => {
    if (!token) return undefined;
    const lower = message.toLowerCase();
    const wantsEmail = /email|inbox|mail|message|unread|reply|respond|draft|send/i.test(lower);
    const wantsCalendar = /schedul|calendar|meeting|event|appointment|today|tomorrow|week/i.test(lower);
    const wantsDrive = /drive|doc|file|document|slide|sheet|folder/i.test(lower);

    if (!wantsEmail && !wantsCalendar && !wantsDrive) return undefined;

    const ctx: LiveContext = {};
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [emailRes, calRes, driveRes] = await Promise.allSettled([
        wantsEmail ? fetch('/api/integrations/gmail/messages?maxResults=10', { headers }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
        wantsCalendar ? fetch('/api/integrations/calendar/events?days=7', { headers }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
        wantsDrive ? fetch('/api/integrations/drive/files?maxResults=15', { headers }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
      ]);
      if (emailRes.status === 'fulfilled' && emailRes.value?.messages) ctx.emails = emailRes.value.messages;
      if (calRes.status === 'fulfilled' && calRes.value?.events) ctx.events = calRes.value.events;
      if (driveRes.status === 'fulfilled' && driveRes.value?.files) ctx.files = driveRes.value.files;
    } catch { /* ignore — non-connected services return 403 gracefully */ }

    return (ctx.emails || ctx.events || ctx.files) ? ctx : undefined;
  }, [token]);

  // ── Early returns (after all hooks) ───────────────────────────────────────
  if (!user || !token) {
    return <LoginView onLogin={handleLogin} />;
  }

  // Show a loading spinner while fetching workspace data from the backend
  if (isLoading || !activeAgent) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-slate-400 font-medium">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const hoursSaved = Math.round(tasks.filter(t => t.status === 'done').reduce((acc, task) => {
    const mapping: Record<string, number> = {
      'blog-writer': 60,
      'social-media-manager': 20,
      'sales-associate': 10,
      'receptionist': 10,
      'legal-associate': 20,
      'executive-assistant': 5,
    };

    let time = mapping[task.assigneeId] || 10;

    const combinedText = (task.title + ' ' + task.description).toLowerCase();

    // Special handling for lead research: 10 mins per lead
    if (task.assigneeId === 'sales-associate' || task.assigneeId === 'receptionist') {
      const leadMatch = combinedText.match(/(\d+)-(\d+)\s+leads/i) ||
        combinedText.match(/(\d+)\s+leads/i);
      if (leadMatch) {
        const count = leadMatch[2] ? (parseInt(leadMatch[1]) + parseInt(leadMatch[2])) / 2 : parseInt(leadMatch[1]);
        time = count * 10;
      }
    }

    // Special handling for blog posts: 60 mins per post
    if (task.assigneeId === 'blog-writer') {
      const postMatch = combinedText.match(/(\d+)\s+blog posts/i) || combinedText.match(/(\d+)\s+posts/i);
      if (postMatch) {
        time = parseInt(postMatch[1]) * 60;
      }
    }

    // Special handling for social media: 20 mins per post
    if (task.assigneeId === 'social-media-manager') {
      const postMatch = combinedText.match(/(\d+)\s+social media posts/i) || combinedText.match(/(\d+)\s+posts/i);
      if (postMatch) {
        time = parseInt(postMatch[1]) * 20;
      }
    }

    return acc + time;
  }, 0) / 60);


  const handleSendMessage = async (content: string) => {
    if (!user) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'user',
      senderName: user.name,
      senderAvatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
      content,
      timestamp: Date.now(),
      type: 'user'
    };

    setMessages(prev => ({
      ...prev,
      [activeAgentId]: [...(prev[activeAgentId] || []), newMessage]
    }));
    persistMessage(newMessage, activeAgentId);

    setIsTyping(true);
    updateAgentStatus(activeAgentId, AgentStatus.THINKING);

    if (activeAgentId.startsWith('team-chat')) {
      // Team Chat logic: pick a relevant agent or have multiple respond
      const eva = agents.find(a => a.id.startsWith('executive-assistant'))!;
      const liveCtx = eva ? await fetchLiveContext(content) : undefined;
      const { text, imageUrl } = await getAgentResponse(eva.role, content, eva.description, false, liveCtx, connectedServices);

      // Check if Eva wants to schedule a task
      const potentialTask = parseTaskFromResponse(text);
      if (potentialTask) {
        handleTaskCreation(potentialTask);
      }

      // Check if Eva wants to create an email draft
      const potentialDraft = parseDraftEmailFromResponse(text);
      let draftStatusMessage = "";
      if (potentialDraft && connectedServices.gmail) {
        try {
          const res = await fetch('/api/integrations/gmail/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(potentialDraft)
          });
          if (res.ok) {
            draftStatusMessage = "\n\n*(I have successfully created a draft reply in your Gmail account.)*";
          } else {
            draftStatusMessage = "\n\n*(I attempted to create a draft reply, but encountered an error. Please ensure Gmail is connected.)*";
          }
        } catch (e) {
          console.error("Failed to inject draft", e);
        }
      }

      const agentResponse: Message = {
        id: (Date.now() + 1).toString(),
        senderId: eva.id,
        senderName: eva.name,
        senderAvatar: eva.avatar,
        content: stripAgentJson(text) + draftStatusMessage,
        imageUrl,
        timestamp: Date.now(),
        type: 'agent'
      };

      setMessages(prev => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), agentResponse]
      }));
      persistMessage(agentResponse, activeAgentId);

      // Simulate another agent joining the conversation
      setTimeout(async () => {
        const otherAgents = agents.filter(a => !a.id.startsWith('team-chat') && !a.id.startsWith('executive-assistant'));
        const randomAgent = otherAgents[Math.floor(Math.random() * otherAgents.length)];
        updateAgentStatus(randomAgent.id, AgentStatus.THINKING);

        const canGenerateImage = randomAgent.capabilities.includes('Image Generation');
        const { text: secondText, imageUrl: secondImageUrl } = await getAgentResponse(randomAgent.role, `In a team context, respond to: ${content}`, randomAgent.description, canGenerateImage);

        // Check if random agent wants to schedule a task
        const secondPotentialTask = parseTaskFromResponse(secondText);
        if (secondPotentialTask) {
          handleTaskCreation(secondPotentialTask);
        }

        const secondAgentResponse: Message = {
          id: (Date.now() + 2).toString(),
          senderId: randomAgent.id,
          senderName: randomAgent.name,
          senderAvatar: randomAgent.avatar,
          content: stripAgentJson(secondText),
          imageUrl: secondImageUrl,
          timestamp: Date.now(),
          type: 'agent'
        };

        setMessages(prev => ({
          ...prev,
          [activeAgentId]: [...(prev[activeAgentId] || []), secondAgentResponse]
        }));
        persistMessage(secondAgentResponse, activeAgentId);
        updateAgentStatus(randomAgent.id, AgentStatus.IDLE);
      }, 2000);

    } else {
      const canGenerateImage = activeAgent.capabilities.includes('Image Generation');
      // Fetch live Google Workspace data for Eva (executive-assistant)
      const isEva = activeAgentId.startsWith('executive-assistant');
      const liveCtx = isEva ? await fetchLiveContext(content) : undefined;
      const { text, imageUrl } = await getAgentResponse(activeAgent.role, content, activeAgent.description, canGenerateImage, liveCtx, isEva ? connectedServices : undefined);

      // Check if agent wants to schedule a task
      const potentialTask = parseTaskFromResponse(text);
      if (potentialTask) {
        handleTaskCreation(potentialTask);
      }

      // Check if agent wants to create an email draft
      const potentialDraft = parseDraftEmailFromResponse(text);
      let draftStatusMessage = "";
      if (potentialDraft && connectedServices.gmail) {
        try {
          const res = await fetch('/api/integrations/gmail/drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(potentialDraft)
          });
          if (res.ok) {
            draftStatusMessage = "\n\n*(I have successfully created a draft reply in your Gmail account.)*";
          } else {
            draftStatusMessage = "\n\n*(I attempted to create a draft reply, but encountered an error. Please ensure Gmail is connected.)*";
          }
        } catch (e) {
          console.error("Failed to inject draft", e);
        }
      }

      const agentResponse: Message = {
        id: (Date.now() + 1).toString(),
        senderId: activeAgentId,
        senderName: activeAgent.name,
        senderAvatar: activeAgent.avatar,
        content: stripAgentJson(text) + draftStatusMessage,
        imageUrl,
        timestamp: Date.now(),
        type: 'agent'
      };

      setMessages(prev => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), agentResponse]
      }));
      persistMessage(agentResponse, activeAgentId);
    }

    setIsTyping(false);
    updateAgentStatus(activeAgentId, AgentStatus.IDLE);
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden font-sans relative">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-100 z-40 flex items-center justify-between px-4">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-slate-500"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="font-bold text-slate-900">Sanford AI</div>
        <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
          <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} alt="User" />
        </div>
      </div>

      {/* Sidebar Rail */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-[72px] bg-white border-r border-slate-100 flex flex-col items-center py-6 gap-8 transition-transform md:relative md:translate-x-0",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="w-10 h-10 flex items-center justify-center">
          <img src="https://api.marblism.com/favicon.ico" alt="Logo" className="w-8 h-8 opacity-80" />
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
                  : "bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-200"
              )}
              title={ws.name}
            >
              {ws.name.substring(0, 2).toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => {
              const name = prompt('Enter workspace name:');
              if (name && token) {
                fetch('/api/workspaces', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                  },
                  body: JSON.stringify({ name })
                })
                  .then(res => res.json())
                  .then(newWs => {
                    setWorkspaces(prev => [...prev, newWs]);
                    setActiveWorkspaceId(newWs.id);
                  });
              }
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 text-slate-400 border-2 border-dashed border-slate-200 hover:border-slate-300 hover:text-slate-600 transition-all"
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
                activeView === item.id ? "text-slate-900 bg-slate-50" : "text-slate-400 hover:text-slate-600"
              )}
              title={item.id.charAt(0).toUpperCase() + item.id.slice(1)}
            >
              {activeView === item.id && (
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-500 rounded-r-full" />
              )}
              <item.icon className="w-6 h-6" />
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-6">
          <button
            onClick={() => {
              setActiveView('settings');
              setShowAgentList(false);
            }}
            className={cn(
              "w-10 h-10 rounded-full bg-slate-100 overflow-hidden border-2 transition-all",
              activeView === 'settings' ? "border-brand-500 scale-110" : "border-slate-200 hover:border-slate-300"
            )}
          >
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} alt="User" />
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
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Agent List Column */}
      <aside className={cn(
        "fixed inset-y-0 left-0 md:relative z-30 w-full md:w-[340px] border-r border-slate-100 flex flex-col bg-white transition-transform md:translate-x-0",
        showAgentList ? "translate-x-0" : "-translate-x-full",
        "pt-16 md:pt-0"
      )}>
        <div className="p-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">Agents</h1>
          <button
            className="md:hidden p-2 text-slate-400"
            onClick={() => setShowAgentList(false)}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {agents.map((agent) => {
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

        {/* Stats Widget */}
        <div className="p-6 mt-auto hidden md:block">
          <div className="bg-orange-50/50 rounded-3xl p-6 relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-4xl font-bold text-slate-900 mb-1">{hoursSaved} <span className="text-2xl font-medium">hours</span></h3>
              <p className="text-sm text-slate-500">saved this month</p>
            </div>
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-orange-200/30 rounded-full blur-3xl" />
            <div className="absolute top-0 right-0 p-4">
              <ChevronLeft className="w-4 h-4 text-slate-300" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className={cn(
        "flex-1 flex flex-col bg-white pt-16 md:pt-0 transition-transform",
        !showAgentList ? "translate-x-0" : "translate-x-full md:translate-x-0"
      )}>
        {activeView === 'chat' ? (
          <ChatInterface
            agent={activeAgent}
            messages={messages[activeAgentId] || []}
            onSendMessage={handleSendMessage}
            isTyping={isTyping}
            onUpdateGuidelines={handleUpdateGuidelines}
            onBack={() => setShowAgentList(true)}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="md:hidden px-6 py-4 border-b border-slate-100 flex items-center gap-4">
              <button onClick={() => setShowAgentList(true)} className="p-2 -ml-2 text-slate-400">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h2 className="font-bold text-slate-900 capitalize">{activeView}</h2>
            </div>
            {activeView === 'media' ? (
              <MediaLibrary activeWorkspaceId={activeWorkspaceId} />
            ) : activeView === 'docs' ? (
              <CompanyKnowledge activeWorkspaceId={activeWorkspaceId} />
            ) : activeView === 'team' ? (
              <TeamManagement activeWorkspaceId={activeWorkspaceId} token={token} />
            ) : activeView === 'settings' ? (
              <SettingsView user={user} token={token} onLogout={handleLogout} />
            ) : (
              <TaskManager
                tasks={tasks}
                agents={agents}
                onUpdateTask={(id, status) => {
                  setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
                  if (activeWorkspaceId) {
                    fetch(`/api/workspaces/${activeWorkspaceId}/tasks/${encodeURIComponent(id)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
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
    </div>
  );
}
