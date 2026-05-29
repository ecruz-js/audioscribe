# AudioScribe

Transcribe WhatsApp voice notes and generate a combined summary, powered by OpenRouter.

## Stack

React 19 + Vite + Express + TypeScript + Tailwind. Transcription and summary use
`google/gemini-2.5-flash` via the OpenRouter chat-completions API.

## Run locally

**Prerequisites:** Node.js, an OpenRouter API key (https://openrouter.ai/keys).

1. Install dependencies: `bun install`
2. Copy `.env.example` to `.env.local` and set `OPENROUTER_API_KEY`.
   Optionally set `OPENROUTER_MODEL` (defaults to `google/gemini-2.5-flash`).
3. Run the app: `bun run dev` → http://localhost:3000

## Features

- Drag & drop or record WhatsApp audio; sequential transcription queue.
- Combined intelligent summary across all transcriptions.
- Transcriptions and summary persist in `localStorage` (audio itself is not stored).
- Per-item delete / retry / copy; copy & download the summary as Markdown.

## Build

`bun run build` then `bun run start` (serves `dist/` in production mode).
