import React from 'react';
import { motion } from 'motion/react';
import { Agent, AgentStatus } from '../types';
import { cn } from '../utils';
import { Activity, Zap, MessageSquare, ShieldCheck, AlertCircle } from 'lucide-react';

interface AgentCardProps {
  agent: Agent;
  isActive: boolean;
  onClick: () => void;
  isUnread?: boolean;
  lastMessage?: {
    content: string;
    timestamp: number;
    senderId?: string;
    senderName?: string;
  };
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, isActive, onClick, isUnread, lastMessage }) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  return (
    <motion.div
      layout
      onClick={onClick}
      className={cn(
        "px-4 py-3 cursor-pointer transition-all duration-200 border-l-4 relative",
        isActive
          ? "bg-warm-100 border-brand-500"
          : "bg-transparent border-transparent hover:bg-warm-50"
      )}
    >
      {isUnread && !isActive && (
        <div className="absolute right-4 top-4 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
      )}
      
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <img
            src={agent.avatar}
            alt={agent.name}
            className={cn(
              "w-12 aspect-[5/7] rounded-lg bg-warm-100 object-cover transition-transform",
              isUnread && !isActive && "scale-105 ring-2 ring-blue-100"
            )}
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <h3 className={cn(
              "text-[15px] truncate",
              isUnread && !isActive ? "font-black text-stone-900" : "font-bold text-stone-900"
            )}>{agent.role}</h3>
            <span className={cn(
              "text-[11px] font-medium",
              isUnread && !isActive ? "text-blue-600" : "text-stone-400"
            )}>
              {lastMessage ? formatTime(lastMessage.timestamp) : (agent.lastAction || 'Just now')}
            </span>
          </div>
          <p className={cn(
            "text-[13px] truncate leading-tight",
            isUnread && !isActive ? "text-stone-900 font-semibold" : "text-stone-500"
          )}>
            <span className={cn(
              "font-medium",
              isUnread && !isActive ? "text-stone-900" : "text-stone-700"
            )}>
              {lastMessage?.senderName || agent.name}:
            </span> {lastMessage ? lastMessage.content : agent.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
};
