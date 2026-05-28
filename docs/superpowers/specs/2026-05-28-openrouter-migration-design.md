# AudioScribe — Migración a OpenRouter + Fixes de Confiabilidad

**Fecha:** 2026-05-28
**Estado:** Aprobado

## Contexto

App scaffold de Google AI Studio. Transcribe audios de WhatsApp y genera un
resumen combinado vía Gemini. Stack: React 19 + Vite + Express + TypeScript.
Estado solo en memoria (se pierde al refrescar). Sin tests, sin git, sin
`node_modules`, sin `.env.local`. Usa `@google/genai` con un model id sospechoso
(`gemini-3.1-pro-preview`).

## Objetivo

1. Sustituir la API de Gemini (`@google/genai` + `GEMINI_API_KEY`) por **OpenRouter**.
2. Usar **`google/gemini-2.5-flash`** vía chat-completions con `input_audio` para
   transcribir (sin trocear audios; maneja audio largo nativamente) y el mismo
   modelo para el resumen (barato).
3. Resolver gaps de confiabilidad/UX: persistencia, límite de subida, acciones por
   item, copiar/descargar, errores inline, sort, a11y, tests, higiene de repo.

## Decisiones tomadas

- **Transcripción y resumen:** `google/gemini-2.5-flash` vía
  `https://openrouter.ai/api/v1/chat/completions`. Se re-verifica el id de
  flash audio-capable más barato vigente al implementar; configurable por
  `OPENROUTER_MODEL`.
- **Persistencia:** `localStorage` — guarda texto (transcripción, resumen) y
  metadatos. **No** guarda el audio crudo (demasiado pesado).
- **Audio largo:** sin chunking; el modelo de chat no tiene el tope de 60s del
  endpoint STT.
- **Límite de subida:** 25MB.
- **Fuera de alcance:** Docker, deploy, base de datos, multi-dispositivo.

## Arquitectura

Sin cambios estructurales. Express sirve Vite (dev) / estáticos (prod) y expone
dos endpoints. Se elimina la dependencia `@google/genai`; las llamadas a
OpenRouter se hacen con `fetch` nativo.

```
Browser (React)                Express server              OpenRouter
  AudioUploader  ──files/blob──▶ POST /api/transcribe ──▶ chat/completions
  App (queue)    ◀──text─────────                          (input_audio)
  generateSummary ──transcripts─▶ POST /api/summarize ──▶ chat/completions
                 ◀──summary──────                          (text)
  localStorage  ◀──persist text/summary
```

## Componentes y cambios

### Backend — `server.ts`
- Quitar import `@google/genai`. Eliminar `getAI()`/`GoogleGenAI`.
- Nuevo helper `callOpenRouter(messages)`:
  - `POST https://openrouter.ai/api/v1/chat/completions`
  - Headers: `Authorization: Bearer ${OPENROUTER_API_KEY}`, `Content-Type: application/json`,
    `HTTP-Referer`, `X-Title: AudioScribe`.
  - Body: `{ model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash', messages }`.
  - Lanza error claro si falta `OPENROUTER_API_KEY` o si la respuesta no es ok.
  - Devuelve `data.choices[0].message.content`.
- `/api/transcribe`:
  - Multer con `limits: { fileSize: 25 * 1024 * 1024 }`; manejar error de tamaño → 413.
  - `mimetype → format` map (`audioFormatFromMime`): ogg, opus, webm, mp3, m4a, wav, aac, flac. Default seguro + 415 si no soportado.
  - Mensaje: `[{ role:'user', content: [ {type:'text', text: prompt}, {type:'input_audio', input_audio:{ data: base64, format }} ] }]`.
- `/api/summarize`: igual `callOpenRouter`, content de texto. Validación de input igual que hoy.

### Frontend
- **`src/hooks/useLocalStorage.ts`** (nuevo): hook genérico get/set con `JSON` + try/catch.
- **Persistencia (`App.tsx`):** persistir `items` (sin `file`/`blob`) y `summary`.
  Al hidratar, los items mantienen su `status`/`transcription`/`error`. Items en
  `idle` sin audio en memoria no se re-procesan (no hay audio que enviar).
- **Sort fix (`App.tsx`):** comparador estable; items sin `date` al final,
  preservando orden de inserción.
- **Acciones por item (`AudioItemsList`/item):**
  - Borrar item.
  - Reintentar: si el item conserva `file`/`blob` en esta sesión, vuelve a `idle`;
    si solo viene de localStorage (sin audio), el botón retry se desactiva.
  - Copiar transcripción.
- **Resumen (`TranscriptionSummary`):** botón copiar y descargar `.md`.
- **Errores inline:** eliminar `alert()` en `App.generateSummary` y
  `AudioUploader.startRecording`; mostrar estado de error en UI.
- **Typo:** `handeFileSelect` → `handleFileSelect`.
- **A11y dropzone (`AudioUploader`):** `role="button"`, `tabIndex={0}`,
  manejo de Enter/Space.

### Config / repo
- `git init` + `.gitignore` ya cubre `.env*`, `node_modules`, `dist`.
- `.env.local` con placeholder (el usuario pega la key real).
- `.env.example`: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (opcional). Quitar `GEMINI_API_KEY`, `APP_URL`.
- `package.json`: quitar `@google/genai`. Renombrar `name` a `audioscribe`.
- README: pasos reales (OpenRouter key, `npm install`, `npm run dev`); título correcto. `index.html` title.

## Flujo de datos

1. Usuario sube/graba → `AudioItem` (`idle`) en estado + localStorage (sin audio).
2. Cola procesa secuencial → `POST /api/transcribe` → `processing` → `done`/`error`.
3. `done` persiste transcripción en localStorage.
4. `Generate Summary` → `POST /api/summarize` con los `done` → `summary` persistido.

## Manejo de errores

- Falta `OPENROUTER_API_KEY`: 500 con mensaje explícito.
- Sin archivo: 400. Archivo > 25MB: 413. Formato no soportado: 415.
- Error OpenRouter (4xx/5xx): se propaga `error.message` al item; UI muestra estado
  `error` + botón reintentar (si hay audio en memoria).
- Resumen sin items `done`: no-op (botón deshabilitado).

## Orden de ejecución

1. `git init` + `npm install`.
2. Migración OpenRouter backend + `.env.local` / `.env.example`.
3. Frontend: format map (lado server) + errores inline + typo.
4. Persistencia localStorage (`useLocalStorage` + `App`).
5. Acciones por item (retry/delete) + copiar/descargar.
6. Sort fix + a11y.
7. README + `package.json` + commit final.

## Fuera de alcance (YAGNI)

- Chunking de audio.
- Base de datos / persistencia multi-dispositivo / del audio crudo.
- Docker / pipeline de deploy.
- Auth.
