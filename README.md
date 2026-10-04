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
- PostgreSQL production persistence with SQLite local fallback
- permanent story/source/research-run archive
- scheduled deep-research pipeline
- source-aware clustering and deduplication
- OpenAI shortlist analysis with Exa/Tavily as optional corroboration providers
- live archive API wired into the reader

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

The live system now has a real persisted pipeline:

`DISCOVER → NORMALIZE → DEDUPLICATE → CLUSTER → OPTIONAL SEARCH → VERIFY/CLASSIFY → SCORE → RANK → STORE → PRESENT → NARRATE`

`/api/research` remains the cheap RSS preview endpoint. The heavier scheduled pipeline lives in `lib/pipeline.ts` and runs through `npm run research:daily`. It stores candidates, selected stories, sources, research steps and run telemetry in relational persistence. Search is optional; OpenAI is used only after deterministic filtering and clustering.

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

1. broaden RSS and geographic coverage;
2. persisted narration cache;
3. server-side pagination and richer history facets;
4. authenticated cross-device favorites when user accounts are introduced;
5. offline-friendly reading cache;
6. deeper extraction for difficult source pages where RSS snippets are insufficient.

## Persistence and scheduled research

The backend now implements the production data seam discussed for Absurdity:

- PostgreSQL when `DATABASE_URL` is configured.
- Built-in SQLite fallback for local development when `DATABASE_URL` is absent.
- Automatic schema initialization plus `db/migrations/001_init.sql` for explicit PostgreSQL provisioning.
- Permanent story/source/research-run records.
- `/api/stories` for the current 48-hour briefing or searchable selected-story history.
- A daily pipeline that clusters RSS candidates, optionally calls Exa/Tavily for corroboration, uses OpenAI only on the shortlist, persists every inspected candidate for dedupe/audit, and promotes only sufficiently supported stories.
- Provider usage and failures are recorded per research run.

Run the deep pipeline manually with:

```bash
npm run research:daily
```

For zero-idle-cost scheduling, `.github/workflows/research.yml` runs once per day when the repository variable `ENABLE_DAILY_RESEARCH=true` is set. Add `DATABASE_URL` as a repository secret. OpenAI and Exa/Tavily remain optional secrets, but OpenAI is required for the full editorial verification/classification layer.

Render remains the web host. The web service can point at any PostgreSQL connection string, including a free external PostgreSQL provider. Absurdity deliberately does not provision a paid Render database or cron job by default.

To switch the deployed reader to persisted live data, set `ABSURDITY_MODE=live` on the web service after the database and scheduled pipeline are configured.
