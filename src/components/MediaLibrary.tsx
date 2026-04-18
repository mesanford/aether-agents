import React from 'react';
import { motion } from 'motion/react';
import { Image as ImageIcon, Video, FileText, Upload, MoreHorizontal, Search, Plus, X, Trash2, Copy } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { cn } from '../utils';
import { apiFetch } from '../services/apiClient';

interface MediaLibraryProps {
  activeWorkspaceId: number | null;
  token: string | null;
  onAuthFailure?: () => void;
}

type MediaItem = {
  id: number;
  name: string;
  type: 'image' | 'video' | 'file';
  category: 'uploads' | 'generated';
  thumbnail: string;
  size?: string | null;
  author?: string | null;
  created_at?: string;
};

export const MediaLibrary: React.FC<MediaLibraryProps> = ({ activeWorkspaceId, token, onAuthFailure }) => {
  const [activeCategory, setActiveCategory] = React.useState<'all' | 'uploads' | 'generated'>('all');
  const [selectedMedia, setSelectedMedia] = React.useState<MediaItem | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [mediaItems, setMediaItems] = React.useState<MediaItem[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read file'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });

  const fetchMedia = React.useCallback(async () => {
    if (!activeWorkspaceId || !token) {
      setMediaItems([]);
      return;
    }

    try {
      const data = await apiFetch<MediaItem[]>(`/api/workspaces/${activeWorkspaceId}/media`, {
        token,
        onAuthFailure,
      });
      setMediaItems(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load media library', error);
      setMediaItems([]);
    }
  }, [activeWorkspaceId, token, onAuthFailure]);

  React.useEffect(() => {
    void fetchMedia();
  }, [fetchMedia]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeWorkspaceId || !token) {
      return;
    }

    try {
      setUploading(true);
      const thumbnail = await readFileAsDataUrl(file);
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/media`, {
        method: 'POST',
        token,
        onAuthFailure,
        body: JSON.stringify({
          name: file.name,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          category: 'uploads',
          thumbnail,
          size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
        }),
      });
      await fetchMedia();
    } catch (error) {
      console.error('Failed to upload media asset', error);
      toast.error('Could not upload this media file.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMedia = async (mediaId: number) => {
    if (!activeWorkspaceId || !token) {
      return;
    }

    try {
      setDeletingId(mediaId);
      await apiFetch(`/api/workspaces/${activeWorkspaceId}/media/${mediaId}`, {
        method: 'DELETE',
        token,
        onAuthFailure,
      });
      setMediaItems((current) => current.filter((item) => item.id !== mediaId));
    } catch (error) {
      console.error('Failed to delete media asset', error);
      toast.error('Could not delete this media file.');
    } finally {
      setDeletingId(null);
    }
  };

  const filteredItems = mediaItems.filter(item => {
    if (activeCategory === 'all') return true;
    return item.category === activeCategory;
  });

  const formatDate = (value?: string) => {
    if (!value) {
      return 'Just now';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Just now';
    }

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  };

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-8 py-4 md:py-6 border-b border-warm-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-stone-900">Media</h1>
          <p className="text-xs md:text-sm text-stone-500 mt-1">
            Give access to your media files to your AI Employees. <span className="font-bold text-stone-700 hidden sm:inline">Only Penny and Sonny can use media files.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="pl-10 pr-4 py-2 bg-warm-50 border border-warm-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none transition-all w-full md:w-64"
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
            <span className="hidden sm:inline">{uploading ? 'Uploading...' : 'Upload'}</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="px-4 md:px-8 border-b border-warm-200 flex gap-6 md:gap-8 overflow-x-auto no-scrollbar">
        {(['all', 'uploads', 'generated'] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "py-3 md:py-4 text-[10px] md:text-xs font-bold uppercase tracking-widest transition-all border-b-2 whitespace-nowrap",
              activeCategory === cat 
                ? "text-stone-900 border-brand-500" 
                : "text-stone-400 border-transparent hover:text-stone-600"
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
              className="aspect-square border-2 border-dashed border-warm-200 rounded-3xl flex flex-col items-center justify-center gap-3 text-stone-400 hover:text-brand-600 hover:border-brand-200 hover:bg-brand-50/50 transition-all group"
            >
              <div className="w-12 h-12 rounded-2xl bg-warm-50 flex items-center justify-center group-hover:bg-white transition-colors">
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
              className="group relative aspect-square bg-white rounded-3xl overflow-hidden border border-warm-200 hover:shadow-xl hover:shadow-slate-200/50 transition-all cursor-pointer"
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
                    <p className="text-white/70 text-[10px] font-medium">{item.size || 'Unknown size'} • {formatDate(item.created_at)}</p>
                    {item.category === 'generated' && (
                      <p className="text-brand-400 text-[10px] font-bold uppercase tracking-wider mt-1">By {item.author || 'Agent'}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedMedia(item);
                    }}
                    className="p-1.5 bg-stone-900/40 backdrop-blur-md rounded-lg text-white hover:bg-stone-900/60 transition-colors shadow-sm"
                    aria-label={`View details for ${item.name}`}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Type Icon Tag */}
              <div className="absolute top-4 left-4 p-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-sm">
                {item.type === 'image' && <ImageIcon className="w-4 h-4 text-stone-600" />}
                {item.type === 'video' && <Video className="w-4 h-4 text-stone-600" />}
                {item.type === 'file' && <FileText className="w-4 h-4 text-stone-600" />}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedMedia && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" style={{ zIndex: 9999 }}>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" 
              onClick={() => setSelectedMedia(null)} 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row"
            >
              <div className="w-full md:w-1/2 bg-warm-100 flex items-center justify-center p-6 border-b md:border-b-0 md:border-r border-warm-200">
                <img src={selectedMedia.thumbnail} alt={selectedMedia.name} className="max-w-full max-h-[40vh] md:max-h-[60vh] object-contain drop-shadow-md rounded-xl" />
              </div>
              <div className="w-full md:w-1/2 flex flex-col pt-4">
                 <div className="flex justify-between items-start px-6 mb-4">
                   <div>
                     <h3 className="font-bold text-lg text-stone-900 break-all pr-4">{selectedMedia.name}</h3>
                     <p className="text-sm text-stone-500">{selectedMedia.size || 'Unknown size'} • {formatDate(selectedMedia.created_at)}</p>
                   </div>
                   <button onClick={() => setSelectedMedia(null)} className="p-2 -mr-2 bg-warm-50 hover:bg-warm-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors">
                     <X className="w-5 h-5" />
                   </button>
                 </div>
                 
                 <div className="px-6 flex-1">
                   <div className="space-y-4 mb-6">
                     <div>
                       <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1">Asset Status</label>
                       <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-bold ring-1 ring-inset ring-emerald-600/20">Active</span>
                     </div>
                     <div>
                       <label className="text-xs font-semibold text-stone-400 uppercase tracking-wider block mb-1">Source</label>
                       <p className="text-sm text-stone-700 font-medium capitalize">{selectedMedia.category} {selectedMedia.author ? `by ${selectedMedia.author}` : ''}</p>
                     </div>
                   </div>
                 </div>
                 
                 <div className="p-4 bg-warm-50 border-t border-warm-200 flex items-center gap-3">
                   <button 
                     onClick={() => void navigator.clipboard.writeText(selectedMedia.thumbnail)}
                     className="flex-1 px-4 py-2 bg-white border border-warm-200 text-stone-700 rounded-xl text-sm font-bold hover:bg-warm-50 hover:border-warm-300 transition-all flex justify-center items-center gap-2"
                   >
                     <Copy className="w-4 h-4" /> Copy URL
                   </button>
                   <button
                     onClick={() => {
                        void handleDeleteMedia(selectedMedia.id);
                        setSelectedMedia(null);
                     }}
                     disabled={deletingId === selectedMedia.id}
                     className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-sm font-bold hover:bg-rose-100 transition-all flex items-center justify-center"
                   >
                     <Trash2 className="w-4 h-4 mr-2" />
                     {deletingId === selectedMedia.id ? 'Deleting...' : 'Delete'}
                   </button>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
