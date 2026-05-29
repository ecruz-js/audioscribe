# AudioScribe

Transcribe WhatsApp voice notes and generate a combined summary, powered by **OpenRouter** (`google/gemini-2.5-flash`).

## What it is

Single-page app: drag/drop or record audio → sequential transcription queue → optional combined "intelligent summary" across all transcriptions. Transcriptions and summary persist in `localStorage` (the raw audio is **not** stored). No database, no auth.

## Architecture

One Node process (`tsx server.ts`) runs **Express with Vite mounted as middleware** — API + frontend served on the **same port (3000)**, not two servers.

```
Browser (React SPA)              Express (server.ts)            OpenRouter
  AudioUploader  ──file/blob──▶  POST /api/transcribe  ──▶  chat/completions (input_audio)
  App (queue)    ◀──{text}──────                              google/gemini-2.5-flash
  generateSummary ─transcripts─▶ POST /api/summarize   ──▶  chat/completions (text)
                 ◀──{text}──────
  localStorage  ◀── persist items (no audio) + summary
```

Request routing is by **path, in mount order**: `/api/*` routes are registered *before* `app.use(vite.middlewares)`, which is the catch-all serving HTML/JS/CSS. In production (`NODE_ENV=production`) Vite is replaced by `express.static('dist')` + SPA fallback.

## Key files

| File | Responsibility |
|---|---|
| `server.ts` | Express server, both API endpoints, `callOpenRouter()` helper, multer upload (25MB limit), mimetype→format map, Vite-middleware (dev) / static (prod) switch |
| `src/App.tsx` | App state, transcription queue (`processQueue`), localStorage hydration/persist, summary generation, per-item handlers |
| `src/components/AudioUploader.tsx` | Drag/drop + file picker + mic recording (MediaRecorder) |
| `src/components/AudioItemsList.tsx` | Queue UI, per-item delete/retry/copy |
| `src/components/TranscriptionSummary.tsx` | Summary display + copy/download `.md` |
| `src/hooks/useLocalStorage.ts` | Generic persisted-state hook |
| `src/types.ts` | `AudioItem`, `AudioStatus` |
| `src/utils.ts` | `parseWhatsAppDate()` (parses `...-WA....` filenames), `cn()`, `formatDate()` |

## Commands (uses **bun**, not npm)

```bash
bun install
bun run dev      # tsx server.ts → http://localhost:3000 (API + frontend)
bun run lint     # tsc --noEmit  ← the only verification gate
bun run build    # vite build + esbuild bundles server → dist/
bun run start    # node dist/server.cjs (production)
```

## Environment

`.env.local` (gitignored) holds secrets:

```
OPENROUTER_API_KEY="sk-or-..."          # required
OPENROUTER_MODEL="google/gemini-2.5-flash"  # optional, this is the default
APP_URL="http://localhost:3000"             # optional, sent as HTTP-Referer
```

`server.ts` loads it via `dotenv.config({ path: ['.env.local', '.env'] })`.

## Conventions & constraints

- **No automated tests** (deliberate). Verify with `bun run lint` + manual run in the browser.
- Transcription uses the **chat-completions `input_audio`** path (not OpenRouter's STT endpoint) so there's no 60s audio cap; long WhatsApp audios work without chunking.
- Items hydrated from `localStorage` have no `file`/`blob` in memory → they are **not** re-transcribed, and retry is hidden for them (no audio to resend). This is intentional.
- Supported audio formats are whitelisted in `MIME_TO_FORMAT` (`server.ts`); unknown mime → 415.

## Gotchas (things that have bitten us)

1. **`dotenv/config` only reads `.env`, not `.env.local`.** The key lives in `.env.local` (Vite convention), so it must be loaded explicitly (already done in `server.ts`). A `OPENROUTER_API_KEY ... is required` error means the env file isn't being loaded.
2. **Blank page after changing deps.** Changing `package.json` / running `bun install` changes the lockfile → Vite re-optimizes deps. If a stale dev server is still running, `.vite/deps` returns **503** for `react`/`react-dom` and the page renders blank with *no* console error. Fix: stop the server, `rm -rf node_modules/.vite`, `bun run dev`.
3. **`tsx` has no watch.** Editing `server.ts` requires a manual dev-server restart.
4. **"Only the server starts, not the frontend"** is a misconception — Vite runs in middleware mode and prints no banner. The frontend is at `:3000`, not `:5173`.
5. **Model id** is configurable via `OPENROUTER_MODEL`; if the default 404s, change it there (verify current ids at https://openrouter.ai/models?q=gemini).

## Design docs

`docs/superpowers/specs/` and `docs/superpowers/plans/` hold the OpenRouter-migration spec and implementation plan.
