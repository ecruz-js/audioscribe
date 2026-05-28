import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2 } from 'lucide-react';

interface TranscriptionSummaryProps {
  summary: string;
  isSummarizing: boolean;
}

export function TranscriptionSummary({ summary, isSummarizing }: TranscriptionSummaryProps) {
  if (!summary && !isSummarizing) return null;

  return (
    <div className="flex-1 flex flex-col gap-4 mb-4">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
        Intelligent Summary
        {isSummarizing && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
      </p>
      
      <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
        <div className="shrink-0 border-b border-white/5 pb-3 mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold text-white">Thread Analysis</h3>
        </div>
        
        <div className="text-xs text-gray-400 leading-relaxed prose prose-invert prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 max-w-none">
          {isSummarizing && !summary ? (
             <div className="space-y-3">
               <div className="h-2 bg-white/10 rounded w-3/4 animate-pulse"></div>
               <div className="h-2 bg-white/10 rounded w-full animate-pulse"></div>
               <div className="h-2 bg-white/10 rounded w-5/6 animate-pulse"></div>
             </div>
          ) : (
            <ReactMarkdown>{summary}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
