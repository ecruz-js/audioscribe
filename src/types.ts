export type AudioStatus = 'idle' | 'processing' | 'done' | 'error';

export interface AudioItem {
  id: string;
  file?: File;
  blob?: Blob;
  fileName: string;
  status: AudioStatus;
  transcription?: string;
  error?: string;
  date?: Date;
}
