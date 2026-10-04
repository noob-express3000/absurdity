# Absurdity

Absurdity is a global strange-news reader. It continuously gathers unusual stories, keeps the useful history, and gives the user a simple place to read, save, dismiss, search and listen to them.

The product rule is simple:

> **Find the stories that make the world feel stranger, then get out of the user's way.**

## Product contract

Absurdity should:

- aggregate unusual stories from around the world on a recurring schedule;
- validate and normalize stories before surfacing them;
- keep source links attached to every story;
- keep a permanent searchable history instead of throwing old stories away;
- show only recent stories on the home feed;
- let users favorite stories;
- let users dismiss stories from the current feed;
- read stories aloud;
- support hands-free navigation where the browser allows speech recognition;
- make old stories discoverable by searchable relational properties such as date, location, category and tags.

## Interface

The application has three primary tabs:

- **New stories** — stories from the current 48-hour window.
- **Favorites** — stories the user saved.
- **History** — the permanent archive with search and timeframe filters.

The main reading layout intentionally stays simple:

1. story-title list on the left;
2. selected story and source links in the main reading pane;
3. narration and navigation controls at the bottom.

On the New stories tab, a story can be dismissed with the × control or a left swipe. Favorites and dismissed-state currently persist in browser `localStorage`.

The seeded Demo Mode anchors its 48-hour window to the newest fixture date so the interaction can still be tested after the fixture dates become old. Live Mode should use wall-clock time.

## Current implementation

- Next.js / React / TypeScript
- Tailwind CSS
- seven seeded demonstration stories
- New stories / Favorites / History navigation
- 48-hour home-feed rule
- permanent demo archive view
- history search and timeframe filtering
- favorites persistence
- dismissed-story persistence
- swipe-to-dismiss
- original-source links
- event/publication date separation
- story verification notes
- ElevenLabs narration route with browser speech fallback
- optional browser speech-recognition commands for hands-free navigation
- lightweight RSS discovery endpoint
- OpenAI, Exa and Tavily provider seams retained for the live research pipeline

## Hands-free commands

Where the browser exposes the Web Speech recognition API, the interface understands commands including:

- `next`
- `previous`
- `favorite`
- `dismiss`
- `read`
- `stop`
- `history`
- `favorites`
- `home`
- `stop listening`

Narration works independently through ElevenLabs when configured and falls back to browser text-to-speech.

## Live research pipeline

The intended live system remains:

`DISCOVER → EXTRACT → NORMALIZE → DEDUPLICATE → FILTER → CLUSTER → VERIFY → CLASSIFY → SCORE → RANK → SUMMARIZE → STORE → PRESENT → NARRATE`

The current `/api/research` endpoint implements lightweight RSS discovery and deterministic triage. It does **not** pretend to be full verification.

The next backend layer should move the story archive into a relational database and add a scheduled research job. The database should make properties such as `publicationDate`, `eventDate`, `country`, `region`, `category`, `tags`, `clusterId`, confidence and source records queryable rather than relying on a static fixture corpus.

## Optional providers

The prototype can run without provider credentials. Optional environment variables are:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `EXA_API_KEY`
- `TAVILY_API_KEY`

Copy `.env.example` to `.env.local` when configuring providers.

## Local setup

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Architecture

- `app/page.tsx` — reader UI, favorites, dismissals, history filters and hands-free controls
- `app/api/narrate/route.ts` — narration endpoint
- `app/api/research/route.ts` — lightweight discovery endpoint
- `app/api/chat/route.ts` — retained grounded-agent seam
- `lib/types.ts` — story and briefing domain model
- `lib/demo-data.ts` — seeded demonstration corpus
- `lib/research.ts` — RSS collection and deterministic triage
- `lib/agent.ts` — deterministic corpus agent
- `lib/providers/intelligence.ts` — optional OpenAI provider
- `lib/providers/search.ts` — optional Exa / Tavily provider
- `lib/providers/voice.ts` — optional ElevenLabs provider

## Render deployment

`render.yaml` defines the current Render web service.

- service: `absurdity`
- plan: free by default
- region: Frankfurt
- build: `npm install && npm run build`
- start: `npm start`
- health check: `/api/health`
- default mode: `ABSURDITY_MODE=demo`

Provider secrets belong in the Render service environment and should never be committed.

## Next build layer

1. relational persistence for stories, sources, favorites and archive metadata;
2. scheduled collection at configurable intervals;
3. model-assisted clustering and verification after cheap deterministic filtering;
4. source-aware deduplication across publishers;
5. live home-feed queries limited to the newest 48 hours;
6. persisted narration cache;
7. richer geographic coverage;
8. offline-friendly reading cache.
