import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, 
  FileText, 
  Image as ImageIcon, 
  Users, 
  CheckSquare, 
  HelpCircle,
  Gift,
  User as UserIcon,
  ChevronLeft,
  Menu
} from 'lucide-react';
import { Agent, AgentRole, AgentStatus, Message, Task, Workspace } from './types';
import { INITIAL_AGENTS, INITIAL_TASKS, INITIAL_MESSAGES } from './constants';
import { AgentCard } from './components/AgentCard';
import { ChatInterface } from './components/ChatInterface';
import { MediaLibrary } from './components/MediaLibrary';
import { CompanyKnowledge } from './components/CompanyKnowledge';
import { TeamManagement } from './components/TeamManagement';
import { TaskManager } from './components/TaskManager';
import { SettingsView } from './components/SettingsView';
import { LoginView } from './components/LoginView';
import { getAgentResponse, parseTaskFromResponse } from './services/geminiService';
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

  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [activeAgentId, setActiveAgentId] = useState<string>(INITIAL_AGENTS[0].id);
  const [messages, setMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);

  const [isTyping, setIsTyping] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'media' | 'docs' | 'team' | 'tasks' | 'settings'>('chat');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAgentList, setShowAgentList] = useState(true);

  // Load workspace-specific data
  useEffect(() => {
    if (!activeWorkspaceId) return;

    const agentsKey = `sanford-agents-${activeWorkspaceId}`;
    const tasksKey = `sanford-tasks-${activeWorkspaceId}`;
    const messagesKey = `sanford-messages-${activeWorkspaceId}`;

    const savedAgents = localStorage.getItem(agentsKey);
    if (savedAgents) setAgents(JSON.parse(savedAgents));
    else setAgents(INITIAL_AGENTS);

    const savedTasks = localStorage.getItem(tasksKey);
    if (savedTasks) {
      const parsedTasks = JSON.parse(savedTasks) as Task[];
      const missingTasks = INITIAL_TASKS.filter(
        (initialTask) => !parsedTasks.some((task) => task.id === initialTask.id)
      );
      setTasks([...parsedTasks, ...missingTasks]);
    } else {
      setTasks(INITIAL_TASKS);
    }

    const savedMessages = localStorage.getItem(messagesKey);
    if (savedMessages) setMessages(JSON.parse(savedMessages));
    else setMessages(INITIAL_MESSAGES);

    // Reset view to chat when switching workspaces
    setActiveView('chat');
    setShowAgentList(true);
    setActiveAgentId(INITIAL_AGENTS[0].id);
  }, [activeWorkspaceId]);

  // Save workspace-specific data
  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-agents-${activeWorkspaceId}`, JSON.stringify(agents));
    }
  }, [agents, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-tasks-${activeWorkspaceId}`, JSON.stringify(tasks));
    }
  }, [tasks, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-messages-${activeWorkspaceId}`, JSON.stringify(messages));
    }
  }, [messages, activeWorkspaceId]);

  useEffect(() => {
    if (token) {
      fetch('/api/workspaces', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        setWorkspaces(data);
        if (data.length > 0 && !activeWorkspaceId) {
          setActiveWorkspaceId(data[0].id);
        }
      })
      .catch(err => console.error('Failed to fetch workspaces', err));
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
    return newTask;
  }, []);

  const handleUpdateGuidelines = useCallback((agentId: string, guidelines: any[]) => {
    setAgents(prev => prev.map(a => 
      a.id === agentId ? { ...a, guidelines } : a
    ));
  }, []);

  if (!user || !token) {
    return <LoginView onLogin={handleLogin} />;
  }

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

    setIsTyping(true);
    updateAgentStatus(activeAgentId, AgentStatus.THINKING);

    if (activeAgentId === 'team-chat') {
      // Team Chat logic: pick a relevant agent or have multiple respond
      const eva = agents.find(a => a.id === 'executive-assistant')!;
      const { text, imageUrl } = await getAgentResponse(eva.role, content, eva.description);
      
      // Check if Eva wants to schedule a task
      const potentialTask = parseTaskFromResponse(text);
      if (potentialTask) {
        handleTaskCreation(potentialTask);
      }

      const agentResponse: Message = {
        id: (Date.now() + 1).toString(),
        senderId: eva.id,
        senderName: eva.name,
        senderAvatar: eva.avatar,
        content: text,
        imageUrl,
        timestamp: Date.now(),
        type: 'agent'
      };

      setMessages(prev => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), agentResponse]
      }));

      // Simulate another agent joining the conversation
      setTimeout(async () => {
        const otherAgents = agents.filter(a => a.id !== 'team-chat' && a.id !== 'executive-assistant');
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
          content: secondText,
          imageUrl: secondImageUrl,
          timestamp: Date.now(),
          type: 'agent'
        };

        setMessages(prev => ({
          ...prev,
          [activeAgentId]: [...(prev[activeAgentId] || []), secondAgentResponse]
        }));
        updateAgentStatus(randomAgent.id, AgentStatus.IDLE);
      }, 2000);

    } else {
      const canGenerateImage = activeAgent.capabilities.includes('Image Generation');
      const { text, imageUrl } = await getAgentResponse(activeAgent.role, content, activeAgent.description, canGenerateImage);
      
      // Check if agent wants to schedule a task
      const potentialTask = parseTaskFromResponse(text);
      if (potentialTask) {
        handleTaskCreation(potentialTask);
      }

      const agentResponse: Message = {
        id: (Date.now() + 1).toString(),
        senderId: activeAgentId,
        senderName: activeAgent.name,
        senderAvatar: activeAgent.avatar,
        content: text,
        imageUrl,
        timestamp: Date.now(),
        type: 'agent'
      };

      setMessages(prev => ({
        ...prev,
        [activeAgentId]: [...(prev[activeAgentId] || []), agentResponse]
      }));
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
              <SettingsView user={user} onLogout={handleLogout} />
            ) : (
              <TaskManager 
                tasks={tasks}
                onUpdateTask={(id, status) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))}
                onCreateTask={handleTaskCreation}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
