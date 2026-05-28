import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud, Mic, Square, Loader2 } from 'lucide-react';
import { cn } from '../utils';

interface AudioUploaderProps {
  onFilesSelected: (files: File[]) => void;
  onAudioRecorded: (blob: Blob) => void;
}

export function AudioUploader({ onFilesSelected, onAudioRecorded }: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('audio/'));
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).filter(file => file.type.startsWith('audio/'));
      if (files.length > 0) {
        onFilesSelected(files);
      }
      e.target.value = ''; // Reset input
    }
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        onAudioRecorded(audioBlob);
        stream.getTracks().forEach(track => track.stop()); // Clean up microphone stream
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingDuration(0);
      
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setMicError('Could not access microphone. Please allow permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 w-full shrink-0">
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "flex-1 h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer text-center group",
          isDragging ? "bg-white/[0.05] border-indigo-500/50" : "bg-white/[0.02] border-white/10 hover:bg-white/[0.04] hover:border-indigo-500/50"
        )}
      >
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-5 h-5 text-indigo-400" />
        </div>
        <h3 className="text-sm font-medium text-gray-200">Drag & Drop Audio Files</h3>
        <p className="text-xs text-gray-500 mt-1 text-balance">
          Drag your WhatsApp voice notes here to start transcription (supports multiple files).
        </p>
        <input 
          type="file" 
          multiple 
          accept="audio/*" 
          className="hidden" 
          ref={fileInputRef}
          onChange={handleFileSelect}
        />
      </div>

      <div className="flex-1">
        {!isRecording ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] p-6 transition-all">
            <h3 className="text-sm font-medium text-gray-200 mb-4">Record voice from microphone</h3>
            <button 
              onClick={startRecording}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-semibold text-sm shadow-lg shadow-indigo-900/20 transition-colors focus:outline-none flex items-center gap-2"
            >
              <Mic className="w-4 h-4" />
              Start Recording
            </button>
            {micError && <p className="text-xs text-red-400 mt-3">{micError}</p>}
          </div>
        ) : (
          <div className="h-full bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-indigo-500/20 p-5 rounded-2xl flex flex-col justify-center">
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-4">Direct Audio Recording</p>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-light text-white">{formatDuration(recordingDuration)}</span>
              </div>
            </div>
            <button 
              onClick={stopRecording}
              className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-semibold text-sm shadow-lg shadow-red-900/20 transition-colors focus:outline-none flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop Recording
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
