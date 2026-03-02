import React from 'react';
import { motion } from 'motion/react';
import { Image as ImageIcon, Video, FileText, Upload, MoreHorizontal, Search, Plus } from 'lucide-react';
import { cn } from '../utils';

interface MediaLibraryProps {
  activeWorkspaceId: number | null;
}

export const MediaLibrary: React.FC<MediaLibraryProps> = ({ activeWorkspaceId }) => {
  const [activeCategory, setActiveCategory] = React.useState<'all' | 'uploads' | 'generated'>('all');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      alert(`File "${file.name}" selected. In a real app, this would be uploaded to your workspace media library.`);
    }
  };
  const [mediaItems, setMediaItems] = React.useState(() => {
    const saved = localStorage.getItem(`sanford-media-${activeWorkspaceId}`);
    if (saved) return JSON.parse(saved);
    return [
      {
        id: '1',
        name: 'MM Sanford Logo',
        type: 'image',
        category: 'uploads',
        thumbnail: 'https://ais-pre-ozn6jhe7zcj3cdiobiz65k-153562024476.us-west2.run.app/logo.png',
        size: '42 KB',
        date: 'Mar 1, 2026'
      },
      {
        id: '2',
        name: 'Innovation Paradox Hero',
        type: 'image',
        category: 'generated',
        thumbnail: 'https://picsum.photos/seed/innovation/800/600',
        size: '156 KB',
        date: 'Mar 1, 2026',
        author: 'Sonny'
      }
    ];
  });

  React.useEffect(() => {
    if (activeWorkspaceId) {
      localStorage.setItem(`sanford-media-${activeWorkspaceId}`, JSON.stringify(mediaItems));
    }
  }, [mediaItems, activeWorkspaceId]);

  const filteredItems = mediaItems.filter(item => {
    if (activeCategory === 'all') return true;
    return item.category === activeCategory;
  });

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-8 py-4 md:py-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Media</h1>
          <p className="text-xs md:text-sm text-slate-500 mt-1">
            Give access to your media files to your AI Employees. <span className="font-bold text-slate-700 hidden sm:inline">Only Penny and Sonny can use media files.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all w-full md:w-64"
            />
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileChange}
          />
          <button 
            onClick={handleUploadClick}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold hover:bg-brand-700 transition-all shadow-lg shadow-brand-500/20 flex items-center gap-2 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-4 md:px-8 border-b border-slate-100 flex gap-6 md:gap-8 overflow-x-auto no-scrollbar">
        {(['all', 'uploads', 'generated'] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "py-3 md:py-4 text-[10px] md:text-xs font-bold uppercase tracking-widest transition-all border-b-2 whitespace-nowrap",
              activeCategory === cat 
                ? "text-slate-900 border-brand-500" 
                : "text-slate-400 border-transparent hover:text-slate-600"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
          {/* Upload Placeholder */}
          {activeCategory !== 'generated' && (
            <button 
              onClick={handleUploadClick}
              className="aspect-square border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center gap-3 text-slate-400 hover:text-brand-600 hover:border-brand-200 hover:bg-brand-50/50 transition-all group"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:bg-white transition-colors">
                <Upload className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider">Upload Media</span>
            </button>
          )}

          {/* Media Items */}
          {filteredItems.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="group relative aspect-square bg-white rounded-3xl overflow-hidden border border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer"
            >
              <img 
                src={item.thumbnail} 
                alt={item.name} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              
              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-bold truncate">{item.name}</p>
                    <p className="text-white/70 text-[10px] font-medium">{item.size} • {item.date}</p>
                    {item.category === 'generated' && (
                      <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider mt-1">By {item.author}</p>
                    )}
                  </div>
                  <button className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg text-white hover:bg-white/30 transition-colors">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Type Icon Tag */}
              <div className="absolute top-4 left-4 p-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm">
                {item.type === 'image' && <ImageIcon className="w-4 h-4 text-slate-600" />}
                {item.type === 'video' && <Video className="w-4 h-4 text-slate-600" />}
                {item.type === 'file' && <FileText className="w-4 h-4 text-slate-600" />}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
