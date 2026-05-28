import React from 'react';
import { AudioItem } from '../types';
import { Loader2, Music, CheckCircle2, AlertCircle, Calendar } from 'lucide-react';
import { formatDate } from '../utils';
import ReactMarkdown from 'react-markdown';

interface AudioItemsListProps {
  items: AudioItem[];
}

export function AudioItemsList({ items }: AudioItemsListProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
         <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Transcription Queue</h2>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={item.id} className="bg-[#141418] border border-white/5 p-4 rounded-xl flex items-start gap-4">
             <div className="text-xs font-mono text-indigo-500 mt-1">
               {(index + 1).toString().padStart(2, '0')}
             </div>
             <div className="flex-1 min-w-0">
               <div className="flex items-center justify-between mb-1">
                 <p className="text-sm font-semibold text-gray-100 truncate">{item.fileName}</p>
                 <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded flex items-center gap-1">
                    {item.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-indigo-500"/>}
                    {item.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400"/>}
                    {item.date ? formatDate(item.date) : "Today"}
                 </span>
               </div>
               
               {item.status === 'processing' && (
                 <div className="w-full bg-white/5 h-1.5 rounded-full mt-2 overflow-hidden">
                   <div className="bg-indigo-500 h-1.5 rounded-full w-2/3 animate-pulse"></div>
                 </div>
               )}
               {item.status === 'error' && (
                 <p className="text-xs text-red-400 mt-2">{item.error}</p>
               )}
               {item.status === 'done' && item.transcription && (
                 <p className="text-xs text-gray-400 leading-relaxed italic prose prose-invert prose-p:my-1 prose-headings:my-2 prose-sm prose-slate max-w-none">
                    "{item.transcription}"
                 </p>
               )}
               {item.status === 'idle' && (
                 <p className="text-xs text-gray-500 mt-2">Queued for transcription...</p>
               )}
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}
