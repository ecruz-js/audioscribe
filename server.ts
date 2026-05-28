import 'dotenv/config';
import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash';

// Mapea el mimetype del archivo subido al `format` que espera OpenRouter input_audio.
const MIME_TO_FORMAT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

function audioFormatFromMime(mime: string): string | null {
  return MIME_TO_FORMAT[mime] ?? null;
}

type ORContent =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

async function callOpenRouter(content: string | ORContent[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
      'X-Title': 'AudioScribe',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenRouter error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('OpenRouter returned an unexpected response shape');
  }
  return text;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Transcribe a single audio file
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const format = audioFormatFromMime(req.file.mimetype || '');
      if (!format) {
        return res
          .status(415)
          .json({ error: `Unsupported audio format: ${req.file.mimetype}` });
      }

      const base64Data = req.file.buffer.toString('base64');
      const prompt = 'Transcribe the following audio accurately. Just output the transcription text.';

      const text = await callOpenRouter([
        { type: 'text', text: prompt },
        { type: 'input_audio', input_audio: { data: base64Data, format } },
      ]);

      res.json({ text });
    } catch (error: any) {
      console.error('Transcription error:', error);
      res.status(500).json({ error: error.message || 'Failed to transcribe' });
    }
  });

  // Summarize multiple transcriptions
  app.post('/api/summarize', async (req, res) => {
    try {
      const { transcripts } = req.body;
      if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
        return res.status(400).json({ error: 'No transcripts provided for summarization' });
      }

      const prompt = `You are a helpful assistant. I will provide you with a list of transcriptions from a series of WhatsApp audio messages. The transcriptions may contain timestamps from the audio files.
Please generate a detailed summary of all the audios combined. Organize the summary logically.

Transcriptions:
${transcripts.map((t: any, idx: number) => `Audio ${idx + 1} (${t.fileName}):\n${t.text}`).join('\n\n')}

Detailed Summary:`;

      const text = await callOpenRouter(prompt);
      res.json({ text });
    } catch (error: any) {
      console.error('Summarization error:', error);
      res.status(500).json({ error: error.message || 'Failed to summarize' });
    }
  });

  // Multer / generic error handler (e.g. file too large -> 413)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Audio file too large (max 25MB)' });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: err?.message || 'Internal server error' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
