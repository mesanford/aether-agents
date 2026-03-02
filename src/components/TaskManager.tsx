import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  Calendar, 
  RefreshCw, 
  User,
  ChevronRight,
  X
} from 'lucide-react';
import { Task, Agent } from '../types';
import { INITIAL_AGENTS } from '../constants';
import { cn } from '../utils';

interface TaskManagerProps {
  tasks: Task[];
  onUpdateTask: (id: string, status: Task['status']) => void;
  onCreateTask: (task: Omit<Task, 'id' | 'status'>) => void;
}

export const TaskManager: React.FC<TaskManagerProps> = ({ tasks, onUpdateTask, onCreateTask }) => {
  const [filter, setFilter] = useState<'all' | 'todo' | 'running' | 'done' | 'failed'>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTask, setNewTask] = useState<Omit<Task, 'id' | 'status'>>({
    title: '',
    description: '',
    assigneeId: INITIAL_AGENTS[0].id,
    dueDate: 'Tomorrow, 9:00 AM',
    repeat: ''
  });

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true;
    return task.status === filter;
  });

  const selectedTask = tasks.find(t => t.id === selectedTaskId);
  const assignee = selectedTask ? INITIAL_AGENTS.find(a => a.id === selectedTask.assigneeId) : null;

  const counts = {
    all: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    running: tasks.filter(t => t.status === 'running').length,
    done: tasks.filter(t => t.status === 'done').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateTask(newTask);
    setIsCreating(false);
    setNewTask({
      title: '',
      description: '',
      assigneeId: INITIAL_AGENTS[0].id,
      dueDate: 'Tomorrow, 9:00 AM',
      repeat: ''
    });
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
          <div className="space-y-1">
            {filteredTasks.map((task) => {
              const agent = INITIAL_AGENTS.find(a => a.id === task.assigneeId);
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={cn(
                    "w-full text-left p-3 md:p-4 rounded-2xl transition-all group flex items-start gap-3 md:gap-4",
                    selectedTaskId === task.id ? "bg-slate-50" : "hover:bg-slate-50/50"
                  )}
                >
                  <div className="mt-1 flex-shrink-0">
                    {task.status === 'done' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <Circle className="w-5 h-5 text-brand-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className={cn(
                      "text-sm font-bold text-slate-900 truncate",
                      task.status === 'done' && "text-slate-500"
                    )}>
                      {task.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-1">{task.description}</p>
                    <div className="flex items-center gap-3 md:gap-4 mt-3">
                      <div className="flex items-center gap-1.5 text-[10px] md:text-[11px] font-medium text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                        {task.dueDate}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                          <img src={agent?.avatar} alt={agent?.name} />
                        </div>
                        <span className="text-[10px] md:text-[11px] font-bold text-slate-500 truncate max-w-[60px] md:max-w-none">{agent?.name}</span>
                      </div>
                    </div>
                  </div>
                </button>
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
                  {selectedTask.status === 'done' && (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-md flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Done
                    </span>
                  )}
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
                  onClick={() => onUpdateTask(selectedTask.id, selectedTask.status === 'done' ? 'todo' : 'done')}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all"
                >
                  Mark as {selectedTask.status === 'done' ? 'To Do' : 'Done'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Task Modal */}
      <AnimatePresence>
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
                    onChange={e => setNewTask({...newTask, title: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assignee</label>
                  <select 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                    value={newTask.assigneeId}
                    onChange={e => setNewTask({...newTask, assigneeId: e.target.value})}
                  >
                    {INITIAL_AGENTS.map(agent => (
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
                      onChange={e => setNewTask({...newTask, dueDate: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Repeat</label>
                    <input 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                      placeholder="e.g. Every day"
                      value={newTask.repeat}
                      onChange={e => setNewTask({...newTask, repeat: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description</label>
                  <textarea 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all min-h-[100px]"
                    placeholder="What needs to be done?"
                    value={newTask.description}
                    onChange={e => setNewTask({...newTask, description: e.target.value})}
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
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <line x1="10" y1="9" x2="8" y2="9"/>
  </svg>
);
