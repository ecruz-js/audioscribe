# AudioScribe — OpenRouter Migration + Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar AudioScribe de la API de Google Gemini a OpenRouter (`google/gemini-2.5-flash` para transcripción vía `input_audio` y resumen), y resolver gaps de confiabilidad/UX (persistencia, límite de subida, acciones por item, copiar/descargar, errores inline, sort, a11y, higiene de repo).

**Architecture:** Express sirve la SPA de Vite y expone `/api/transcribe` y `/api/summarize`, que llaman a OpenRouter chat-completions vía `fetch` nativo. El frontend React mantiene una cola secuencial de transcripción y persiste texto/resumen en `localStorage`.

**Tech Stack:** React 19, Vite 6, Express 4, TypeScript, Tailwind 4, OpenRouter API. **Sin tests** (fuera de alcance por decisión del usuario); verificación vía `npm run lint` (`tsc --noEmit`) y ejecución manual.

**Spec:** `docs/superpowers/specs/2026-05-28-openrouter-migration-design.md`

**Nota sobre verificación sin tests:** Cada tarea termina con `npm run lint` (debe pasar sin errores de tipos) y, donde aplica, una comprobación manual descrita. No se escriben archivos de test.

**Nota sobre el model id:** Antes de la Tarea 2, verificar en https://openrouter.ai/models?q=gemini el id de flash audio-capable más barato vigente. Por defecto `google/gemini-2.5-flash`; configurable por `OPENROUTER_MODEL`.

---

### Task 1: Dependencias e instalación base

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Quitar `@google/genai` y renombrar el paquete**

En `package.json`, cambiar `"name": "react-example"` por `"name": "audioscribe"` y eliminar la línea de dependencia `"@google/genai": "^2.6.0",`.

- [ ] **Step 2: Instalar dependencias**

Run: `npm install`
Expected: Crea `node_modules/`, sin errores. `@google/genai` ya no aparece.

- [ ] **Step 3: Verificar lint base**

Run: `npm run lint`
Expected: PASS (sin errores de tipos). Si `server.ts` aún importa `@google/genai`, fallará — se arregla en Task 2. Si falla solo por eso, continuar.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove @google/genai, rename package to audioscribe"
```

---

### Task 2: Backend — migración a OpenRouter

**Files:**
- Modify: `server.ts` (reescritura completa)

- [ ] **Step 1: Reescribir `server.ts`**

Reemplazar TODO el contenido de `server.ts` por:

```ts
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
```

- [ ] **Step 2: Verificar lint**

Run: `npm run lint`
Expected: PASS. `@google/genai` ya no se importa.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat: migrate backend to OpenRouter chat-completions with input_audio"
```

---

### Task 3: Configuración de entorno

**Files:**
- Modify: `.env.example`
- Create: `.env.local`

- [ ] **Step 1: Reescribir `.env.example`**

Reemplazar TODO el contenido de `.env.example` por:

```
# OPENROUTER_API_KEY: Required. Get one at https://openrouter.ai/keys
OPENROUTER_API_KEY="sk-or-..."

# OPENROUTER_MODEL: Optional. Audio-capable chat model used for transcription + summary.
# Defaults to google/gemini-2.5-flash if unset.
OPENROUTER_MODEL="google/gemini-2.5-flash"

# APP_URL: Optional. Used as the HTTP-Referer header for OpenRouter.
APP_URL="http://localhost:3000"
```

- [ ] **Step 2: Crear `.env.local` con placeholder**

Crear `.env.local` (ignorado por git) con:

```
OPENROUTER_API_KEY="PEGA_TU_KEY_AQUI"
OPENROUTER_MODEL="google/gemini-2.5-flash"
APP_URL="http://localhost:3000"
```

- [ ] **Step 3: Verificar que dotenv carga `.env.local`**

`dotenv` ya está en deps. Confirmar que `server.ts` lo carga: el script `dev` usa `tsx server.ts`. Si las env vars no se inyectan automáticamente, añadir al inicio de `server.ts` (antes de cualquier uso de `process.env`):

```ts
import 'dotenv/config';
```

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit (NO commitear `.env.local`)**

```bash
git add .env.example server.ts
git commit -m "chore: switch env config to OPENROUTER_API_KEY"
```

Verificar: `git status` NO debe listar `.env.local` (cubierto por `.gitignore`).

- [ ] **Step 5: Comprobación manual end-to-end**

El usuario pega su key real en `.env.local`. Luego:
Run: `npm run dev`
Subir un audio de WhatsApp en el navegador y verificar que aparece la transcripción. Generar resumen y verificar texto.

---

### Task 4: Frontend — errores inline, typo, a11y

**Files:**
- Modify: `src/components/AudioUploader.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Arreglar typo y a11y en `AudioUploader.tsx`**

Renombrar `handeFileSelect` → `handleFileSelect` (declaración en línea 40 y uso en `onChange`).

Reemplazar el reporte de error de micrófono: cambiar el estado del componente para mostrar error inline en vez de `alert`. Añadir al inicio del componente, junto a los demás `useState`:

```tsx
const [micError, setMicError] = useState<string | null>(null);
```

En `startRecording`, en el `catch`, reemplazar:

```tsx
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone. Please allow permissions.');
```

por:

```tsx
      console.error('Error accessing microphone:', err);
      setMicError('Could not access microphone. Please allow permissions.');
```

Y al inicio de `startRecording` (antes del `try`), limpiar: `setMicError(null);`

Renderizar el error: dentro del bloque `!isRecording`, después del botón "Start Recording", añadir:

```tsx
            {micError && <p className="text-xs text-red-400 mt-3">{micError}</p>}
```

A11y del dropzone: en el `<div>` con `onClick={() => fileInputRef.current?.click()}`, añadir props:

```tsx
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
```

- [ ] **Step 2: Quitar `alert` en `App.tsx` generateSummary**

Añadir estado de error de resumen junto a los `useState` de `App`:

```tsx
  const [summaryError, setSummaryError] = useState<string | null>(null);
```

En `generateSummary`, al inicio (junto a `setSummary('')`): `setSummaryError(null);`
En el `catch`, reemplazar:

```tsx
      console.error(error);
      alert('Failed to generate summary');
```

por:

```tsx
      console.error(error);
      setSummaryError('Failed to generate summary');
```

Renderizar el error: justo antes de `<TranscriptionSummary ... />` en el JSX:

```tsx
        {summaryError && <p className="text-xs text-red-400">{summaryError}</p>}
```

- [ ] **Step 3: Verificar lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AudioUploader.tsx src/App.tsx
git commit -m "fix: inline error UI, fix handleFileSelect typo, dropzone a11y"
```

---

### Task 5: Persistencia en localStorage

**Files:**
- Create: `src/hooks/useLocalStorage.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Crear `useLocalStorage` hook**

Crear `src/hooks/useLocalStorage.ts`:

```tsx
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or unavailable — ignore
    }
  }, [key, value]);

  return [value, setValue];
}
```

- [ ] **Step 2: Persistir items (sin audio) y summary en `App.tsx`**

El tipo `AudioItem` tiene `file?: File` y `blob?: Blob`, que no son serializables. Persistimos una versión sin esos campos. Añadir imports en `App.tsx`:

```tsx
import { useLocalStorage } from './hooks/useLocalStorage';
```

Cambiar la declaración de estado de `items` y `summary`. `items` debe seguir teniendo `file`/`blob` en memoria, pero persistir solo el resto. Estrategia: mantener `items` en `useState` normal, y un `useEffect` que persista una proyección serializable; al montar, hidratar desde localStorage.

Reemplazar:

```tsx
  const [items, setItems] = useState<AudioItem[]>([]);
  const [summary, setSummary] = useState<string>('');
```

por:

```tsx
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
```

Añadir un `useEffect` que persista `items` sin `file`/`blob` (justo después de la declaración de `processQueue` o cerca de los otros effects):

```tsx
  useEffect(() => {
    try {
      const serializable = items.map(({ file, blob, ...rest }) => rest);
      localStorage.setItem('audioscribe.items', JSON.stringify(serializable));
    } catch {
      // ignore
    }
  }, [items]);
```

- [ ] **Step 3: Verificar lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Comprobación manual**

Run: `npm run dev`
Transcribir un audio, refrescar la página → la transcripción y el resumen persisten. Items hidratados desde localStorage no tienen `file`/`blob` (no se re-suben).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLocalStorage.ts src/App.tsx
git commit -m "feat: persist transcriptions and summary to localStorage"
```

---

### Task 6: Acciones por item — borrar, reintentar, copiar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AudioItemsList.tsx`

- [ ] **Step 1: Añadir handlers en `App.tsx`**

Añadir dentro del componente `App`, antes del `return`:

```tsx
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
```

Pasar los handlers al componente: cambiar `<AudioItemsList items={items} />` por:

```tsx
        <AudioItemsList items={items} onDelete={handleDeleteItem} onRetry={handleRetryItem} />
```

- [ ] **Step 2: Aceptar props y renderizar acciones en `AudioItemsList.tsx`**

Añadir imports de iconos: cambiar la línea de import de lucide a:

```tsx
import { Loader2, AlertCircle, Trash2, RotateCcw, Copy } from 'lucide-react';
```

(Se eliminan `Music`, `CheckCircle2`, `Calendar` si no se usan; mantener solo los usados.)

Cambiar la interface y la firma:

```tsx
interface AudioItemsListProps {
  items: AudioItem[];
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
}

export function AudioItemsList({ items, onDelete, onRetry }: AudioItemsListProps) {
```

Dentro del `.map`, en la cabecera del item (el `<div className="flex items-center justify-between mb-1">`), añadir botones de acción junto al `<span>` de estado. Reemplazar ese `<span>` por un contenedor:

```tsx
                 <div className="flex items-center gap-2 shrink-0">
                   <span className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded flex items-center gap-1">
                      {item.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-indigo-500"/>}
                      {item.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400"/>}
                      {item.date ? formatDate(item.date) : "Today"}
                   </span>
                   {item.status === 'done' && item.transcription && (
                     <button
                       onClick={() => navigator.clipboard.writeText(item.transcription ?? '')}
                       title="Copy transcription"
                       className="text-gray-500 hover:text-indigo-400 transition-colors"
                     >
                       <Copy className="w-3.5 h-3.5" />
                     </button>
                   )}
                   {item.status === 'error' && (item.file || item.blob) && (
                     <button
                       onClick={() => onRetry(item.id)}
                       title="Retry"
                       className="text-gray-500 hover:text-indigo-400 transition-colors"
                     >
                       <RotateCcw className="w-3.5 h-3.5" />
                     </button>
                   )}
                   <button
                     onClick={() => onDelete(item.id)}
                     title="Delete"
                     className="text-gray-500 hover:text-red-400 transition-colors"
                   >
                     <Trash2 className="w-3.5 h-3.5" />
                   </button>
                 </div>
```

- [ ] **Step 3: Verificar lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Comprobación manual**

Run: `npm run dev`
Verificar: borrar item lo quita; copiar copia al portapapeles; reintentar en un item con error re-procesa (solo si se subió en esta sesión).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AudioItemsList.tsx
git commit -m "feat: per-item delete, retry, and copy transcription"
```

---

### Task 7: Resumen — copiar y descargar

**Files:**
- Modify: `src/components/TranscriptionSummary.tsx`

- [ ] **Step 1: Añadir botones copiar/descargar**

Cambiar el import de lucide:

```tsx
import { Sparkles, Loader2, Copy, Download } from 'lucide-react';
```

En el header del bloque de resumen (el `<div className="shrink-0 border-b ...">`), convertirlo en `justify-between` y añadir acciones (visibles solo cuando hay `summary` y no está cargando). Reemplazar ese div por:

```tsx
        <div className="shrink-0 border-b border-white/5 pb-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold text-white">Thread Analysis</h3>
          </div>
          {summary && !isSummarizing && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(summary)}
                title="Copy summary"
                className="text-gray-500 hover:text-indigo-400 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([summary], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'summary.md';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title="Download summary (.md)"
                className="text-gray-500 hover:text-indigo-400 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
```

- [ ] **Step 2: Verificar lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/TranscriptionSummary.tsx
git commit -m "feat: copy and download summary as markdown"
```

---

### Task 8: Sort estable de items

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Arreglar el comparador en `handleFilesSelected`**

Reemplazar el bloque de sort actual:

```tsx
      return combined.sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        // If sorting mixed with no dates, just put dates later or maintain order
        return 0; // naive for now
      });
```

por un sort estable que pone los items sin fecha al final preservando orden de inserción:

```tsx
      return combined
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const da = a.item.date?.getTime();
          const db = b.item.date?.getTime();
          if (da != null && db != null) return da - db;
          if (da != null) return -1; // con fecha va antes
          if (db != null) return 1;
          return a.index - b.index; // ambos sin fecha: orden de inserción
        })
        .map(({ item }) => item);
```

- [ ] **Step 2: Verificar lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "fix: stable item sort, undated items keep insertion order"
```

---

### Task 9: README, título y commit final

**Files:**
- Modify: `README.md`
- Modify: `index.html`

- [ ] **Step 1: Actualizar título en `index.html`**

Cambiar `<title>My Google AI Studio App</title>` por `<title>AudioScribe</title>`.

- [ ] **Step 2: Reescribir `README.md`**

Reemplazar TODO el contenido por:

```markdown
# AudioScribe

Transcribe WhatsApp voice notes and generate a combined summary, powered by OpenRouter.

## Stack

React 19 + Vite + Express + TypeScript + Tailwind. Transcription and summary use
`google/gemini-2.5-flash` via the OpenRouter chat-completions API.

## Run locally

**Prerequisites:** Node.js, an OpenRouter API key (https://openrouter.ai/keys).

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY`.
   Optionally set `OPENROUTER_MODEL` (defaults to `google/gemini-2.5-flash`).
3. Run the app: `npm run dev` → http://localhost:3000

## Features

- Drag & drop or record WhatsApp audio; sequential transcription queue.
- Combined intelligent summary across all transcriptions.
- Transcriptions and summary persist in `localStorage` (audio itself is not stored).
- Per-item delete / retry / copy; copy & download the summary as Markdown.

## Build

`npm run build` then `npm run start` (serves `dist/` in production mode).
```

- [ ] **Step 3: Verificar lint y arranque**

Run: `npm run lint`
Expected: PASS.
Run: `npm run dev` y comprobar que la app arranca en http://localhost:3000.

- [ ] **Step 4: Commit final**

```bash
git add README.md index.html
git commit -m "docs: rewrite README and app title for AudioScribe/OpenRouter"
```

---

## Notas de implementación

- **No escribir tests** (decisión del usuario). La verificación es `npm run lint` + comprobación manual.
- **No commitear `.env.local`** (cubierto por `.gitignore`).
- Mantener los commits pequeños y por tarea como se indica.
- Los items hidratados desde `localStorage` no conservan `file`/`blob`; por eso retry está deshabilitado para ellos (no hay audio que reenviar). Esto es intencional.
