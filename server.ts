import express from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialization, fails if key is missing later.
  let ai: GoogleGenAI | null = null;
  function getAI() {
    if (!ai) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }
      ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
    }
    return ai;
  }

  // API to transcribe a single audio file
  app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const client = getAI();
      const base64Data = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype || 'audio/mp3'; // Fallback if missing

      const prompt = `Transcribe the following audio accurately. Just output the transcription text.`;

      const response = await client.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            { text: prompt },
            { 
              inlineData: { 
                data: base64Data, 
                mimeType 
              } 
            }
          ]
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({ error: error.message || "Failed to transcribe" });
    }
  });

  // API to summarize multiple transcriptions
  app.post('/api/summarize', async (req, res) => {
    try {
      const { transcripts } = req.body;
      if (!transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
        return res.status(400).json({ error: 'No transcripts provided for summarization' });
      }

      const client = getAI();
      
      const prompt = `You are a helpful assistant. I will provide you with a list of transcriptions from a series of WhatsApp audio messages. The transcriptions may contain timestamps from the audio files.
Please generate a detailed summary of all the audios combined. Organize the summary logically.

Transcriptions:
${transcripts.map((t, idx) => `Audio ${idx + 1} (${t.fileName}):\n${t.text}`).join('\n\n')}

Detailed Summary:`;

      const response = await client.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Summarization error:", error);
      res.status(500).json({ error: error.message || "Failed to summarize" });
    }
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
