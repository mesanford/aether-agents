import React from 'react';
import { motion } from 'motion/react';
import { Agent, AgentStatus } from '../types';
import { cn } from '../utils';
import { Activity, Zap, MessageSquare, ShieldCheck, AlertCircle } from 'lucide-react';

interface AgentCardProps {
  agent: Agent;
  isActive: boolean;
  onClick: () => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, isActive, onClick }) => {
  return (
    <motion.div
      layout
      onClick={onClick}
      className={cn(
        "px-4 py-3 cursor-pointer transition-all duration-200 border-l-4",
        isActive 
          ? "bg-slate-50 border-brand-500" 
          : "bg-white border-transparent hover:bg-slate-50/50"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <img 
            src={agent.avatar} 
            alt={agent.name} 
            className="w-12 h-12 rounded-lg bg-slate-100 object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <h3 className="font-bold text-slate-900 text-[15px] truncate">{agent.role}</h3>
            <span className="text-[11px] text-slate-400 font-medium">
              {agent.lastAction || 'Just now'}
            </span>
          </div>
          <p className="text-[13px] text-slate-500 truncate leading-tight">
            <span className="font-medium text-slate-700">{agent.name}:</span> {agent.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
};
