import React, { useState, useEffect, useRef } from 'react';
import { AudioUploader } from './components/AudioUploader';
import { AudioItemsList } from './components/AudioItemsList';
import { TranscriptionSummary } from './components/TranscriptionSummary';
import { AudioItem, AudioStatus } from './types';
import { parseWhatsAppDate } from './utils';
import { MessageSquareQuote, Sparkles } from 'lucide-react';
import { useLocalStorage } from './hooks/useLocalStorage';

export default function App() {
  const [items, setItems] = useState<AudioItem[]>(() => {
    try {
      const raw = localStorage.getItem('audioscribe.items');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as AudioItem[];
      // Las fechas se serializan como string -> rehidratar a Date
      return parsed.map((it) => ({ ...it, date: it.date ? new Date(it.date) : undefined }));
    } catch {
      return [];
    }
  });
  const [summary, setSummary] = useLocalStorage<string>('audioscribe.summary', '');
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  
  // Track if we are currently processing queue so we don't start multiple workers
  const isProcessingQueue = useRef(false);

  const processQueue = async (currentItems: AudioItem[]) => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    let updatedItems = [...currentItems];

    for (let i = 0; i < updatedItems.length; i++) {
      if (updatedItems[i].status === 'idle') {
        const item = updatedItems[i];
        
        // Mark as processing
        setItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'processing' } : p));
        
        try {
          const formData = new FormData();
          if (item.file) {
            formData.append('audio', item.file);
          } else if (item.blob) {
            formData.append('audio', item.blob, item.fileName);
          }

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to transcribe');
          }

          const data = await response.json();
          
          setItems(prev => prev.map(p => p.id === item.id ? { 
            ...p, 
            status: 'done', 
            transcription: data.text 
          } : p));
        } catch (error: any) {
          setItems(prev => prev.map(p => p.id === item.id ? { 
            ...p, 
            status: 'error', 
            error: error.message 
          } : p));
        }
      }
    }
    
    isProcessingQueue.current = false;
  };

  useEffect(() => {
    // Whenever items change and there are idle items, try processing them
    const hasIdle = items.some(item => item.status === 'idle');
    if (hasIdle) {
      processQueue(items);
    }
  }, [items]);

  useEffect(() => {
    try {
      const serializable = items.map(({ file, blob, ...rest }) => rest);
      localStorage.setItem('audioscribe.items', JSON.stringify(serializable));
    } catch {
      // ignore
    }
  }, [items]);

  const handleFilesSelected = (files: File[]) => {
    const newItems: AudioItem[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      fileName: file.name,
      status: 'idle',
      date: parseWhatsAppDate(file.name)
    }));
    
    // Sort items if they have dates
    setItems(prev => {
      const combined = [...prev, ...newItems];
      return combined.sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        // If sorting mixed with no dates, just put dates later or maintain order
        return 0; // naive for now
      });
    });
  };

  const handleAudioRecorded = (blob: Blob) => {
    const defaultName = `Recording-${new Date().getTime()}.webm`;
    const newItem: AudioItem = {
      id: crypto.randomUUID(),
      blob,
      fileName: defaultName,
      status: 'idle',
      date: new Date()
    };
    
    setItems(prev => [...prev, newItem]);
  };

  const generateSummary = async () => {
    const completedItems = items.filter(item => item.status === 'done' && item.transcription);
    if (completedItems.length === 0) return;

    setIsSummarizing(true);
    setSummary('');
    setSummaryError(null);

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcripts: completedItems })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Summarization failed');
      }

      const data = await response.json();
      setSummary(data.text);
    } catch (error) {
      console.error(error);
      setSummaryError('Failed to generate summary');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleDeleteItem = (id: string) => {
    setItems(prev => prev.filter(p => p.id !== id));
  };

  const handleRetryItem = (id: string) => {
    setItems(prev => prev.map(p => {
      // Solo se puede reintentar si aún hay audio en memoria de esta sesión
      if (p.id === id && (p.file || p.blob)) {
        return { ...p, status: 'idle', error: undefined };
      }
      return p;
    }));
  };

  const completedCount = items.filter(i => i.status === 'done').length;
  const canSummarize = completedCount > 0 && !isSummarizing;

  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0B] text-gray-300 font-sans overflow-x-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-8 border-b border-white/10 bg-[#0F0F12] sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
             <MessageSquareQuote className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-white uppercase">Audio<span className="text-indigo-400">Scribe</span></h1>
        </div>
        <div className="flex items-center gap-6">
          {items.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {completedCount} / {items.length} Transcribed
            </div>
          )}
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[10px] text-white font-bold">ME</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 w-full flex-1 flex flex-col gap-6">
        <AudioUploader onFilesSelected={handleFilesSelected} onAudioRecorded={handleAudioRecorded} />

        {items.length > 0 && (
          <div className="flex justify-end mb-2">
            <button
              onClick={generateSummary}
              disabled={!canSummarize}
              className="bg-white/5 hover:bg-white/10 border border-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-indigo-300 px-5 py-2 rounded-lg text-[10px] uppercase font-bold tracking-widest transition-colors focus:outline-none flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate Summary
            </button>
          </div>
        )}

        {summaryError && <p className="text-xs text-red-400">{summaryError}</p>}
        <TranscriptionSummary summary={summary} isSummarizing={isSummarizing} />

        <AudioItemsList items={items} onDelete={handleDeleteItem} onRetry={handleRetryItem} />

      </main>
    </div>
  );
}
