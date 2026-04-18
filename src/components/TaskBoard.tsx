import React from 'react';
import { motion } from 'motion/react';
import { Task } from '../types';
import { CheckCircle2, Circle, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '../utils';

interface TaskBoardProps {
  tasks: Task[];
}

export const TaskBoard: React.FC<TaskBoardProps> = ({ tasks }) => {
  return (
    <div className="bg-white rounded-3xl border border-warm-200 shadow-sm overflow-hidden flex flex-col h-full">
      <div className="px-6 py-4 border-b border-warm-200 flex items-center justify-between bg-warm-50/50">
        <h2 className="font-bold text-stone-900 flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-500" />
          Active Operations
        </h2>
        <span className="text-[10px] font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full">
          {tasks.filter(t => t.status !== 'done').length} Pending
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-stone-400 py-10">
            <Circle className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-xs">No active tasks in queue</p>
          </div>
        ) : (
          tasks.map((task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn(
                "p-3 rounded-xl border flex items-start gap-3 transition-colors",
                task.status === 'done' ? "bg-warm-50 border-warm-200" : "bg-white border-warm-200"
              )}
            >
              <div className="mt-0.5">
                {task.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Circle className="w-4 h-4 text-stone-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className={cn(
                    "text-xs font-semibold truncate",
                    task.status === 'done' ? "text-stone-400 line-through" : "text-stone-800"
                  )}>
                    {task.title}
                  </h4>
                </div>
                <p className="text-[10px] text-stone-500 line-clamp-1 mb-2">{task.description}</p>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-warm-100 border border-white flex items-center justify-center overflow-hidden">
                    <img 
                      src={`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${task.assigneeId.split('-')[0]}`}
                      alt={task.assigneeId} 
                      className="w-4 h-4"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
