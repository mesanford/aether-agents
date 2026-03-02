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
import { Agent, AgentRole, AgentStatus, Message, Task } from './types';
import { INITIAL_AGENTS, INITIAL_TASKS, INITIAL_MESSAGES } from './constants';
import { AgentCard } from './components/AgentCard';
import { ChatInterface } from './components/ChatInterface';
import { MediaLibrary } from './components/MediaLibrary';
import { CompanyKnowledge } from './components/CompanyKnowledge';
import { TeamManagement } from './components/TeamManagement';
import { TaskManager } from './components/TaskManager';
import { getAgentResponse, parseTaskFromResponse } from './services/geminiService';
import { cn } from './utils';

export default function App() {
  const [agents, setAgents] = useState<Agent[]>(() => {
    const saved = localStorage.getItem('sanford-agents');
    return saved ? JSON.parse(saved) : INITIAL_AGENTS;
  });
  const [tasks, setTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('sanford-tasks');
    if (saved) {
      const parsedTasks = JSON.parse(saved) as Task[];
      const missingTasks = INITIAL_TASKS.filter(
        (initialTask) => !parsedTasks.some((task) => task.id === initialTask.id)
      );
      return [...parsedTasks, ...missingTasks];
    }
    return INITIAL_TASKS;
  });
  const [activeAgentId, setActiveAgentId] = useState<string>(INITIAL_AGENTS[0].id); // Default to Eva
  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
    const saved = localStorage.getItem('sanford-messages');
    return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
  });

  useEffect(() => {
    localStorage.setItem('sanford-agents', JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem('sanford-tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('sanford-messages', JSON.stringify(messages));
  }, [messages]);

  const [isTyping, setIsTyping] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'media' | 'docs' | 'team' | 'tasks'>('chat');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showAgentList, setShowAgentList] = useState(true);

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

  const handleSendMessage = async (content: string) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: 'user',
      senderName: 'Marcus Sanford',
      senderAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=marcus',
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
          <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=marcus" alt="User" />
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
            >
              {activeView === item.id && (
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-brand-500 rounded-r-full" />
              )}
              <item.icon className="w-6 h-6" />
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-6">
          <div className="w-8 h-8 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=marcus" alt="User" />
          </div>
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
          {agents.map((agent) => (
            <AgentCard 
              key={agent.id} 
              agent={agent} 
              isActive={activeAgentId === agent.id}
              onClick={() => {
                setActiveAgentId(agent.id);
                setActiveView('chat');
                setShowAgentList(false);
              }}
            />
          ))}
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
              <MediaLibrary />
            ) : activeView === 'docs' ? (
              <CompanyKnowledge />
            ) : activeView === 'team' ? (
              <TeamManagement />
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
