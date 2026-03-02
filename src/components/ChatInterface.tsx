import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Agent, Message, GuidelineSection, GuidelineItem } from '../types';
import { Send, Settings, MoreHorizontal, Paperclip, ArrowUp, ChevronLeft, ChevronRight, Users, X, Calendar, Mail, Clock, Plus, MessageSquare, Share2, FileText, Download, Eye, Trash2, File, Edit2, Check, Trash } from 'lucide-react';
import Markdown from 'react-markdown';
import { cn } from '../utils';

interface ChatInterfaceProps {
  agent: Agent;
  messages: Message[];
  onSendMessage: (content: string) => void;
  isTyping: boolean;
  onUpdateGuidelines: (agentId: string, guidelines: GuidelineSection[]) => void;
  onBack?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  agent, 
  messages, 
  onSendMessage, 
  isTyping, 
  onUpdateGuidelines,
  onBack 
}) => {
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState('Chat');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab('Chat');
  }, [agent.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, activeTab]);

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input);
      setInput('');
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
    const handleUpdateSectionTitle = (sectionId: string, newTitle: string) => {
      const updated = agent.guidelines.map(s => 
        s.id === sectionId ? { ...s, title: newTitle } : s
      );
      onUpdateGuidelines(agent.id, updated);
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
      onUpdateGuidelines(agent.id, updated);
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
      onUpdateGuidelines(agent.id, updated);
    };

    const handleDeleteSection = (sectionId: string) => {
      const updated = agent.guidelines.filter(s => s.id !== sectionId);
      onUpdateGuidelines(agent.id, updated);
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
      onUpdateGuidelines(agent.id, updated);
    };

    const handleAddSection = () => {
      if (!newSectionTitle.trim()) return;
      const newSection: GuidelineSection = {
        id: Date.now().toString(),
        title: newSectionTitle,
        items: [],
        showInput: true
      };
      onUpdateGuidelines(agent.id, [...agent.guidelines, newSection]);
      setNewSectionTitle('');
    };

    return (
      <div className="flex-1 overflow-y-auto p-12 bg-white">
        <div className="max-w-4xl">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-4xl font-bold text-slate-900">Guidelines</h1>
          </div>
          <p className="text-slate-500 mb-10">Use this space to give {agent.name} custom instructions to follow</p>

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
                              <Markdown>{item.content}</Markdown>
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
    const columns = [
      { id: 'drafts', title: '18 Drafts', posts: [
        { id: 'd1', title: 'AI Local Packs are hiding your leads. 🚨', time: 'DRAFT', image: 'https://picsum.photos/seed/ai-local/400/300' },
        { id: 'd2', title: 'In banking and insurance, "data leakage" isn\'t just a glitch...', time: 'DRAFT', image: 'https://picsum.photos/seed/data-leak/400/300' }
      ]},
      { id: 'tue', title: 'Tue 24', posts: [
        { id: 't1', title: 'Gov and Higher Ed shouldn\'t be with "look-back"...', time: '9:00 AM', image: 'https://picsum.photos/seed/gov/400/300' },
        { id: 't2', title: 'The "Thank you" as your only metric...', time: '10:00 AM', image: 'https://picsum.photos/seed/metric/400/300' }
      ]},
      { id: 'wed', title: 'Wed 25', posts: [
        { id: 'w1', title: 'Traditional keyword research is hitting a ceiling.', time: '9:00 AM', image: 'https://picsum.photos/seed/keyword/400/300' },
        { id: 'w2', title: 'Most university "AI Strategies" are actually just future tech debt...', time: '10:00 AM', image: 'https://picsum.photos/seed/debt/400/300' }
      ]},
      { id: 'thu', title: 'Thu 26', posts: [
        { id: 'th1', title: 'Stop hitting the GA4 "API Quota" wall.', time: '9:00 AM', image: 'https://picsum.photos/seed/ga4/400/300' },
        { id: 'th2', title: 'Most scaling hurdles aren\'t about a lack of data...', time: '10:00 AM', image: 'https://picsum.photos/seed/scale/400/300' }
      ]},
      { id: 'fri', title: 'Fri 27', posts: [
        { id: 'f1', title: 'Stop optimizing for blue links. Start optimizing for LLM citation...', time: '9:00 AM', image: 'https://picsum.photos/seed/llm/400/300' },
        { id: 'f2', title: 'AI Overviews aren\'t just "taking clicks": they\'re fundamentally rewriting...', time: '10:00 AM', image: 'https://picsum.photos/seed/rewrite/400/300' }
      ]},
      { id: 'sat', title: 'Sat 28', posts: [
        { id: 's1', title: 'Weekend Strategy: Why retention is the new growth.', time: '11:00 AM', image: 'https://picsum.photos/seed/retention/400/300' }
      ]},
      { id: 'sun', title: 'Sun 29', posts: [
        { id: 'su1', title: 'Sunday Reflections: The future of autonomous agents.', time: '10:00 AM', image: 'https://picsum.photos/seed/future/400/300' }
      ]}
    ];

    return (
      <div className="flex-1 flex flex-col bg-slate-50/30 min-w-0 overflow-hidden">
        {/* Calendar Header */}
        <div className="px-6 py-4 flex items-center justify-between bg-white border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronLeft className="w-5 h-5" /></button>
            <h3 className="font-bold text-slate-900">Feb 23 - Mar 1</h3>
            <button className="p-1 hover:bg-slate-100 rounded-lg text-slate-400"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
            <Users className="w-4 h-4" />
            Accounts
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-x-auto flex p-6 gap-6 scroll-smooth">
          {columns.map(col => (
            <div key={col.id} className="w-[300px] flex-shrink-0 flex flex-col gap-6">
              <h4 className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest">{col.title}</h4>
              <div className="space-y-4">
                {col.posts.map(post => (
                  <div key={post.id} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all group cursor-pointer">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-[10px]">in</div>
                        <span className="text-[10px] font-bold text-slate-400">{post.time}</span>
                      </div>
                      <p className="text-[13px] text-slate-700 font-medium line-clamp-2 mb-4 leading-relaxed">
                        {post.title}
                      </p>
                    </div>
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      <img src={post.image} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" referrerPolicy="no-referrer" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* Spacer for right padding in scroll */}
          <div className="w-1 flex-shrink-0" />
        </div>
      </div>
    );
  };

  const [selectedBlogPost, setSelectedBlogPost] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLead, setSelectedLead] = useState<any>(null);
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

  useEffect(() => {
    if (activeTab === 'Leads') {
      fetchLeads();
    }
  }, [activeTab]);

  const fetchLeads = async () => {
    try {
      const response = await fetch('/api/leads');
      const data = await response.json();
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

    return (
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* CRM Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-4 flex-1 max-w-md">
            <div className="relative flex-1">
              <input 
                type="text" 
                placeholder="Search" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            </div>
            <span className="text-xs font-bold text-slate-400 whitespace-nowrap">{filteredLeads.length} results</span>
          </div>
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all">
            Import Leads
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4 w-12"><input type="checkbox" className="rounded border-slate-300" /></th>
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
                  <td className="px-6 py-4" onClick={e => e.stopPropagation()}><input type="checkbox" className="rounded border-slate-300" /></td>
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
                <h2 className="text-xl font-bold text-slate-900">{selectedSequence.title}</h2>
                <button className="p-1 text-blue-500 hover:bg-blue-50 rounded transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider">Running</span>
              </div>
              <button className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/10">
                View Progress
              </button>
            </div>
          </div>

          {/* Editor Canvas */}
          <div className="flex-1 bg-slate-50/30 p-12 relative min-h-fit">
            <div className="max-w-2xl mx-auto flex flex-col items-center">
              <div className="text-right w-full mb-8">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{selectedSequence.schedule}</p>
              </div>

              <div className="flex flex-col items-center w-full space-y-0">
                {selectedSequence.steps.map((step: any, index: number) => (
                  <React.Fragment key={step.id}>
                    {step.type === 'Wait' ? (
                      <div className="flex flex-col items-center py-4">
                        <div className="w-0.5 h-8 bg-slate-200" />
                        <div 
                          onClick={() => setEditingStep(step)}
                          className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-600 rounded-full border border-orange-100 shadow-sm cursor-pointer hover:bg-orange-100 transition-all"
                        >
                          <Clock className="w-4 h-4" />
                          <span className="text-xs font-bold">{step.title}</span>
                        </div>
                        <div className="w-0.5 h-8 bg-slate-200" />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center w-full">
                        {index > 0 && selectedSequence.steps[index-1].type !== 'Wait' && (
                          <div className="w-0.5 h-8 bg-slate-200" />
                        )}
                        <div 
                          onClick={() => setEditingStep(step)}
                          className={cn(
                            "w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer relative",
                            step.type === 'LinkedIn' && "border-blue-200 bg-blue-50/10",
                            step.type === 'SMS' && "border-emerald-200 bg-emerald-50/10",
                            step.type === 'Social' && "border-purple-200 bg-purple-50/10"
                          )}
                        >
                          <div className="flex items-start gap-4">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                              step.type === 'Enroll' ? "bg-slate-50 text-slate-400" :
                              step.type === 'Email' ? "bg-slate-50 text-slate-600" :
                              step.type === 'SMS' ? "bg-emerald-50 text-emerald-600" :
                              step.type === 'Social' ? "bg-purple-50 text-purple-600" :
                              "bg-blue-50 text-blue-600"
                            )}>
                              {step.type === 'Enroll' && <Users className="w-5 h-5" />}
                              {step.type === 'Email' && <Mail className="w-5 h-5" />}
                              {step.type === 'SMS' && <MessageSquare className="w-5 h-5" />}
                              {step.type === 'Social' && <Share2 className="w-5 h-5" />}
                              {step.type === 'LinkedIn' && <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>}
                            </div>
                            <div className="flex-1">
                              <h4 className="font-bold text-slate-900 text-sm">{step.title}</h4>
                              <p className="text-xs text-slate-500 mt-1">{step.subtitle}</p>
                            </div>
                            <button className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-slate-50 rounded text-slate-400 transition-all">
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                          </div>
                          
                          {/* Add Step Button (Floating) */}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const newStep = { id: Date.now(), type: 'Email', title: 'New Step', subtitle: 'Step content here' };
                              const updatedSteps = [...selectedSequence.steps];
                              updatedSteps.splice(index + 1, 0, newStep);
                              const updatedSequences = sequences.map(seq => seq.id === selectedSequence.id ? {...seq, steps: updatedSteps} : seq);
                              setSequences(updatedSequences);
                              setSelectedSequence(updatedSequences.find(s => s.id === selectedSequence.id));
                            }}
                            className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-brand-600 hover:border-brand-200 shadow-sm transition-all z-10 opacity-0 group-hover:opacity-100"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
                
                {/* Final Add Step */}
                <div className="py-8">
                  <button 
                    onClick={() => {
                      const newStep = { id: Date.now(), type: 'Email', title: 'New Step', subtitle: 'Step content here' };
                      const updatedSequences = sequences.map(seq => seq.id === selectedSequence.id ? {...seq, steps: [...seq.steps, newStep]} : seq);
                      setSequences(updatedSequences);
                      setSelectedSequence(updatedSequences.find(s => s.id === selectedSequence.id));
                    }}
                    className="w-12 h-12 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center text-slate-300 hover:text-brand-500 hover:border-brand-200 transition-all"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          {renderStepEditor()}
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
    const posts = [
      { id: 1, title: 'The ROI Shield: Why Server-Side Tracking is the Future of Attribution', date: 'Feb 28, 2026', image: 'https://picsum.photos/seed/roi/400/200', content: 'Full content for ROI Shield...' },
      { id: 2, title: '10 Reasons Your Local Visibility Dropped: And How to Fix It Right Now', date: 'Feb 27, 2026', content: 'Full content for Local Visibility...' },
      { id: 3, title: '7 Mistakes You\'re Making with GBP Tracking - Narrative Fix', date: 'Feb 26, 2026', image: 'https://picsum.photos/seed/gbp/400/200', content: 'Full content for GBP Tracking...' },
      { id: 4, title: 'Local SEO Audit: The DIY Checklist for Small Business Owners', date: 'Feb 25, 2026', content: 'Full content for SEO Audit...' },
      { id: 5, title: '7 Mistakes You\'re Making with GBP Tracking: And Why Your ROI Is a Lie', date: 'Feb 24, 2026', content: 'Full content for ROI Lie...' },
      { id: 6, title: 'The ROI Shield: Why Server-Side Tracking is the Future of Attribution', date: 'Feb 23, 2026', content: 'Full content for ROI Shield 2...' },
      { id: 7, title: '10 Reasons Your Local Visibility Dropped: And How to Fix It Right Now', date: 'Feb 22, 2026', content: 'Full content for Local Visibility 2...' },
      { id: 8, title: 'Local SEO Audit: The DIY Checklist for Small Business Owners', date: 'Feb 21, 2026', content: 'Full content for SEO Audit 2...' },
      { id: 9, title: '7 Mistakes You\'re Making with GBP Tracking: And Why Your ROI Is a Lie', date: 'Feb 20, 2026', content: 'Full content for ROI Lie 2...' }
    ];

    return (
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Sub Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex gap-6">
            <button className="text-sm font-bold text-slate-900 border-b-2 border-slate-900 pb-4 -mb-4">List</button>
            <button className="text-sm font-bold text-slate-400 hover:text-slate-600 pb-4 -mb-4">Calendar</button>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
            <Users className="w-4 h-4" />
            Accounts
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <p className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-wider">Showing 1-9 of 86 blog posts</p>
          
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
                  <div className="mt-auto flex items-center justify-end gap-3 text-slate-300">
                    <button className="hover:text-slate-500"><Calendar className="w-4 h-4" /></button>
                    <button className="hover:text-slate-500"><MoreHorizontal className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-12 flex items-center justify-between border-t border-slate-100 pt-8">
            <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
              <span>1-9 of 86 blog posts</span>
              <div className="flex gap-1">
                <button className="p-1 hover:bg-slate-100 rounded"><ChevronLeft className="w-4 h-4" /></button>
                <button className="p-1 hover:bg-slate-100 rounded"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5, '...', 8].map((p, i) => (
                <button 
                  key={i}
                  className={cn(
                    "w-8 h-8 rounded-lg text-xs font-bold transition-all",
                    p === 1 ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-100"
                  )}
                >
                  {p}
                </button>
              ))}
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs font-bold text-slate-400">Go to</span>
                <input className="w-12 h-8 border border-slate-200 rounded-lg text-center text-xs font-bold focus:ring-0" placeholder="Page" />
              </div>
            </div>
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
                  <h2 className="font-bold text-slate-900">Blog Post Preview</h2>
                  <button onClick={() => setSelectedBlogPost(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-12">
                  <div className="max-w-2xl mx-auto">
                    <div className="text-sm font-bold text-brand-600 mb-4 uppercase tracking-widest">{selectedBlogPost.date}</div>
                    <h1 className="text-4xl font-bold text-slate-900 mb-8 leading-tight">{selectedBlogPost.title}</h1>
                    {selectedBlogPost.image && (
                      <img src={selectedBlogPost.image} alt="Hero" className="w-full rounded-2xl mb-8 shadow-lg" referrerPolicy="no-referrer" />
                    )}
                    <div className="markdown-body text-slate-700 leading-relaxed text-lg">
                      <Markdown>{selectedBlogPost.content}</Markdown>
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

  const tabs = agent.id === 'social-media-manager' 
    ? ['Chat', 'Posts', 'Guidelines'] 
    : agent.id === 'blog-writer'
    ? ['Chat', 'Blog Posts', 'Guidelines']
    : agent.id === 'sales-associate'
    ? ['Chat', 'Leads', 'Sequence', 'Guidelines']
    : agent.id === 'legal-associate'
    ? ['Chat', 'Documents', 'Guidelines']
    : ['Chat', 'Guidelines'];

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
          <button className="hidden sm:flex items-center gap-1.5 text-sm font-medium hover:text-slate-600 transition-colors">
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button className="hover:text-slate-600 transition-colors p-2">
            <MoreHorizontal className="w-5 h-5" />
          </button>
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
            {tab === 'Leads' && <span className="mr-2">👥</span>}
            {tab === 'Sequence' && <span className="mr-2">📧</span>}
            {tab === 'Documents' && <span className="mr-2">📂</span>}
            {tab === 'Guidelines' && <span className="mr-2">📁</span>}
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Guidelines' ? renderGuidelines() : activeTab === 'Posts' ? renderPosts() : activeTab === 'Blog Posts' ? renderBlogPosts() : activeTab === 'Leads' ? renderLeads() : activeTab === 'Sequence' ? renderSequences() : activeTab === 'Documents' ? renderDocuments() : (
        <>
          {/* Messages */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-8 space-y-8"
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
                      <Markdown>{msg.content}</Markdown>
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
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <div className="flex gap-4 animate-pulse">
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex-shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-2 bg-slate-100 rounded w-1/4" />
                  <div className="h-2 bg-slate-100 rounded w-3/4" />
                </div>
              </div>
            )}
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

            <form onSubmit={handleSubmit} className="relative">
              <div className="flex items-center bg-white border border-slate-200 rounded-2xl px-4 py-3 focus-within:border-brand-500 transition-all shadow-sm">
                <button type="button" className="text-slate-400 hover:text-slate-600 mr-3">
                  <Paperclip className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Write message"
                  className="flex-1 bg-transparent border-none p-0 text-[15px] focus:ring-0 placeholder:text-slate-300"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="ml-3 p-1.5 bg-slate-100 text-slate-300 rounded-lg hover:bg-brand-600 hover:text-white disabled:opacity-50 transition-all"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
