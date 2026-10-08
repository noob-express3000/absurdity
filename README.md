# Absurdity

Absurdity is a strange-news reader that finds unusual real stories, checks them against source material, stores them, and lets you read or listen to them later.

The product idea is simple:

> Find the stories that make the world feel stranger, verify them, then get out of the reader's way.

## What it does

Absurdity gives you three views:

- **Home** — verified stories published in the last 7 days.
- **Favorites** — stories you saved in this browser.
- **History** — verified stories older than 7 days.

Home and History never overlap. A story lives in one age bucket at a time, while Favorites is independent.

You can also:

- refresh the feed to discover new stories;
- ask for stories by topic, place or date;
- navigate with voice where browser speech recognition is available;
- ask follow-up questions about the current story;
- hear stories read aloud;
- dismiss Home stories without deleting them from the archive;
- open the original source links for every story.

## How it works

```text
GitHub Actions ──scheduled trigger──► Render /api/research

Browser ────────────────────────────► Render / Next.js
                                          │
                         ┌────────────────┼────────────────┐
                         │                │                │
                         ▼                ▼                ▼
                        Exa              Groq          ElevenLabs
                   discovery/search   verification      narration
                         │                │
                         └────────┬───────┘
                                  ▼
                                Turso
                         persistent story archive
```

**Render is the application backend.**  
**Turso is the persistent database.**  
**GitHub Actions is only the scheduler.**

The browser never receives provider secrets.

## Research pipeline

A Refresh starts the production research pipeline:

```text
DISCOVER
  ↓
NORMALIZE
  ↓
DEDUPLICATE
  ↓
CLUSTER
  ↓
CORROBORATE
  ↓
EXTRACT ARTICLES
  ↓
VERIFY / CLASSIFY
  ↓
SCORE
  ↓
STORE
```

### Discovery

Exa is the primary discovery provider. RSS feeds provide secondary coverage and fallback discovery. Tavily can be used as an optional search fallback.

### Verification

Groq receives the gathered evidence and produces the editorial result: whether the story is worth keeping, how credible it is, where it happened, how serious it is, and the final reader-friendly summary.

### Article ingestion

Absurdity attempts to retrieve the publisher page rather than trusting a headline alone. Article fetching includes:

- public HTTP/HTTPS URL enforcement;
- private-address and unsafe-scheme rejection;
- redirect revalidation;
- DNS/socket pinning;
- response-size limits;
- content-type checks;
- request deadlines;
- readable-body extraction with Mozilla Readability.

Source pages are treated as untrusted data.

## Refresh behavior

There are three different kinds of "refresh":

### Manual research

Pressing **Refresh**, or explicitly asking the agent to refresh, starts a new research cycle.

Manual cycles share a **5-minute cooldown** so repeated clicks do not waste provider quota.

### Scheduled research

GitHub Actions runs the Daily research workflow once per day at:

```text
03:17 UTC
05:17 South Africa
```

The workflow does not run a second copy of the backend. It simply calls the production Render `/api/research` endpoint and polls the returned run until it finishes.

The same workflow can be started manually from:

```text
GitHub → Actions → Daily research → Run workflow
```

### Passive archive refresh

While the app is open, it periodically checks Turso for newly saved stories and checks again when the tab regains focus.

This does **not** start discovery and does not spend Exa or Groq quota.

## Voice and narration

Simple navigation commands can stay local in the browser:

```text
next
previous
home
history
favorites
favorite
dismiss
read
stop
```

Conversational requests go through `/api/chat` and are grounded in the stored story archive.

Explicit requests such as:

```text
refresh the stories
fetch new stories
get the latest stories
```

start the same research path as the Refresh button.

Narration uses ElevenLabs when configured and falls back to browser text-to-speech if needed.

## Persistence

Production stories live in Turso.

The database stores:

- stories;
- sources;
- extracted evidence;
- research steps;
- research runs;
- the shared research lease.

Render verifies Turso connectivity before starting the production app.

Favorites and dismissed-state are currently stored in browser `localStorage`, so they persist on the same browser/device without requiring accounts.

## Reliability

Render uses two different health concepts:

- `/api/live` — fast provider-independent liveness check used by Render;
- `/api/health` — deeper database/provider diagnostics.

The production start command is:

```bash
npm run db:check && npm start
```

Research runs also use a shared database lease to prevent duplicate overlapping cycles. A run that remains stuck for 30 minutes becomes stale and retryable.

## Stack

- Next.js 16
- React 19
- TypeScript
- Turso Cloud
- Exa
- Groq
- ElevenLabs
- Mozilla Readability
- GitHub Actions
- Render

## Local development

Requirements:

- Node.js 22.22.2+
- npm

Install and run:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

Useful checks:

```bash
npm test
npm run typecheck
npm run build
```

## Environment

Copy `.env.example` to `.env.local` for local configuration.

Main provider variables:

```text
GROQ_API_KEY
GROQ_MODEL
ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID
EXA_API_KEY
TAVILY_API_KEY
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

Production provider/database secrets belong in Render, not in the repository.

## Deployment

The Render Blueprint is defined in `render.yaml`.

Production settings include:

```text
Build:  npm ci && npm run build
Start:  npm run db:check && npm start
Health: /api/live
Mode:   live
```

The daily GitHub workflow only schedules production research; it does not duplicate Render's secrets or backend environment.

## Repository guide

```text
app/page.tsx                    reader UI
app/api/stories/route.ts        story archive API
app/api/research/route.ts       research trigger/status
app/api/chat/route.ts           grounded conversation
app/api/narrate/route.ts        narration
app/api/live/route.ts           liveness
app/api/health/route.ts         diagnostics

lib/pipeline.ts                 research pipeline
lib/research.ts                 discovery
lib/articles.ts                 safe article retrieval/extraction
lib/repository.ts               story persistence
lib/story-lifecycle.ts          7-day Home/History rules
lib/providers/*                 Exa, Groq and ElevenLabs adapters

docs/QA.md                      detailed reliability notes
```

## Demo mode

Demo fixtures exist for local development and QA only.

Production never silently falls back to fixtures. Demo mode must be explicitly enabled server-side with:

```text
ABSURDITY_MODE=demo
```

Otherwise the application runs against the persistent live archive.

## Status

Absurdity is feature-complete for the current submission build. The repository includes automated regression coverage, production build checks, browser smoke/reliability checks, Turso startup validation, and Render deployment health checks.

For the deeper implementation and reliability record, see [docs/QA.md](docs/QA.md).
