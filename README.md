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
- **History** — the permanent archive, navigated and searched through the agent on request.

The main reading layout intentionally stays simple:

1. story-title list on the left;
2. selected story followed by source links and a compact date/verification footer in the main reading pane;
3. small narration and navigation controls at the bottom.

The whole reader fits one viewport. The title list and article scroll internally. Search and date fields are handled by agent instructions instead of occupying the default interface. If speech recognition is unavailable or microphone access is denied, a compact instruction box appears.

On the New stories tab, a story can be dismissed with the × control or a left swipe. Favorites and dismissed-state currently persist in browser `localStorage`.

The seeded Demo Mode is an explicit local/QA fixture mode only. It anchors its 48-hour window to the newest fixture date so interaction tests stay useful after fixture dates age. Production does not fall back to fixtures: unless `ABSURDITY_MODE=demo` is explicitly set, the reader uses persistent live storage and wall-clock time.

## Current implementation

- Next.js / React / TypeScript
- Tailwind CSS
- explicit seven-story fixture mode for local/QA only; live mode never substitutes fixtures
- New stories / Favorites / History navigation
- 48-hour home-feed rule
- permanent demo archive view
- requested archive search by location, keywords, category and publication date
- favorites persistence
- dismissed-story persistence
- swipe-to-dismiss
- original-source links
- event/publication date separation
- ElevenLabs narration route with browser speech fallback
- optional browser speech-recognition commands for hands-free navigation
- Exa-first global discovery with RSS secondary/fallback coverage and explicit refresh cycles
- Turso Cloud production persistence with SQLite local fallback
- permanent story/source/research-run archive
- constant-query archive hydration: History loads story rows, sources and research steps in three database queries instead of two extra queries per story
- scheduled deep-research pipeline
- source-aware clustering and deduplication
- Groq shortlist analysis with Exa as the primary discovery/corroboration provider and Tavily as corroboration fallback
- live archive API wired into the reader with passive focus/5-minute refresh

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
- `find South African stories`
- `find animal stories from the last week`
- `find stories on 2026-10-01`
- `find animal stories in my favorites`

Navigation searches only stored stories when requested. Explicit instructions such as `refresh the stories` or `fetch new stories` start the same ingestion cycle as the **Refresh** control; the question-mark logo and Home are navigation only. Questions and archive searches never start discovery. Exact publication-date instructions use Johannesburg calendar days; demo relative periods anchor to the newest fixture.

The microphone uses browser speech recognition. Simple commands stay local for fast navigation; questions, conversational instructions and requested searches go to Groq through `/api/chat`. Groq receives the selected article, visible titles and the last eight conversation turns, and returns a validated reader action plus a grounded reply. Searches query only the stored archive. Conversation history stays in page memory. The chat button opens an empty, compact typed input with no command list, placeholder or explanatory text, also available automatically if microphone access is denied or recognition is unsupported.

Set `GROQ_API_KEY` on the Render service to enable conversation; the default model is `openai/gpt-oss-120b`. This is a Groq-hosted model and uses no OpenAI API key. Without Groq, simple commands and deterministic archive searches remain available; live answers never fall back to fixture claims. Groq currently handles reasoning and navigation, while browser recognition handles speech-to-text.

The play button or `read` reads the selected title and article through ElevenLabs when configured, falling back to browser text-to-speech when unavailable. Agent replies use the same playback pipeline. Both `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` must be set in Render and deployed; the key requires Text to Speech permission and access to the selected voice. Narration errors now show a short actionable notice before using device speech, including missing configuration, invalid voice, permissions and quota errors. Raw provider errors and secrets are never returned to the browser. The microphone pauses during speech and resumes afterward until toggled off or told `stop listening`. Use the stop control to interrupt a reply; `stop` cancels narration or a pending conversation while listening. Changing the story or view also cancels pending work. The dock shows listening, thinking, preparing and speaking states.

## Live research pipeline

The live system now has a real persisted pipeline:

`DISCOVER → NORMALIZE → DEDUPLICATE → CLUSTER → OPTIONAL SEARCH → EXTRACT ARTICLES → VERIFY/CLASSIFY → SCORE → RANK → STORE → PRESENT → NARRATE`

Clicking **Refresh** or explicitly asking the agent to refresh calls `POST /api/research` to start the full pipeline from `lib/pipeline.ts`. The response returns immediately; the Refresh button spins while the reader polls `GET /api/research?id=…` and reloads the archive on completion. The question-mark logo and **Home** return to new stories without starting research. Reloading the page resumes an active cycle without launching another. The current reader remains usable during fetching. Failed archive requests preserve already loaded stories and show a retry control; a successful empty live response clears the feed without substituting demo fixtures. Ordinary navigation and voice archive searches never initiate discovery. Completion reports how many candidates were reviewed and stories selected.

Before extraction, corroboration, or model analysis, the pipeline skips already-selected events by canonical source URL or matching event cluster within the research window. These skips do not consume the candidate cap and are recorded as `alreadySelected` in run telemetry. Unselected candidates remain eligible for later verification. Freshness is applied before publisher caps, and Exa candidates retain priority through the final shortlist.

A shared database lease prevents duplicate manual cycles and overlap with `npm run research:daily`. Manual starts have a five-minute shared cooldown. Background work uses Next.js `after()` on the Render Node server; a service restart can interrupt it, and a stale run becomes failed/retryable after 30 minutes. This is not a durable queue or continuous real-time news stream. The page fetches its archive on load and after a tracked cycle finishes, then passively refreshes the saved Turso archive every five minutes while visible and whenever the tab regains focus. Passive refresh never launches discovery or spends model calls.

When EXA_API_KEY is configured, discovery starts with freshness-bounded Exa news searches across rotating editorial lenses for local incidents, animals, public authorities, transport, science/technology, courts, culture and global regional reporting. Results are domain-diversified before clustering. UPI Odd News, Guardian World, BBC World, ABC Australia and NPR World remain secondary/fallback feeds. Exa search ranking never promotes a story by itself: candidates still pass extraction, corroboration, Groq verification/classification, scoring and persistence. Provider failures and editorial rejection can still produce a small selected briefing.

The scheduled pipeline also runs through `npm run research:daily`. It stores candidates, selected stories, sources, research steps and run telemetry in relational persistence. Search is optional; Groq is used only after deterministic filtering and clustering.

## Optional providers

The prototype can run without provider credentials. Optional environment variables are:

- `GROQ_API_KEY`
- `GROQ_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `EXA_API_KEY`
- `TAVILY_API_KEY`

Copy `.env.example` to `.env.local` when configuring providers.

## Local setup

Requirements: Node.js 22.22.2+ (including built-in SQLite) and npm. The pinned deployment runtime is in `.node-version`.

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful checks:

```bash
npm run typecheck
npm test
npm run build
```

## Architecture

- `app/page.tsx` — reader UI, favorites, dismissals and agent navigation
- `app/api/narrate/route.ts` — narration endpoint
- `app/api/research/route.ts` — manual research trigger and cycle status
- `app/api/chat/route.ts` — retained grounded-agent seam
- `lib/types.ts` — story and briefing domain model
- `lib/demo-data.ts` — seeded demonstration corpus
- `lib/research.ts` — RSS collection and deterministic triage
- `lib/agent.ts` — deterministic corpus agent
- `lib/navigation.ts` — explicit in-app navigation and archive search instructions
- `lib/providers/intelligence.ts` — optional Groq provider
- `lib/providers/search.ts` — optional Exa / Tavily provider
- `lib/providers/voice.ts` — optional ElevenLabs provider

## Full article ingestion

Daily research now retrieves up to three source pages per shortlisted story and uses Mozilla Readability to extract the readable article body. Scripts and remote page assets never run. Requests allow only public HTTP(S) addresses, validate and pin DNS addresses for each redirect, and enforce a 12-second deadline, four redirects and a 2 MiB HTML limit.

Full extracted text is stored in `story_evidence` alongside publisher, requested/final URLs, publication/retrieval timestamps, extraction status and a SHA-256 content hash. The reader APIs return summaries and source links without shipping full evidence bodies for every archived story. Bodies over 120,000 characters are explicitly marked as clipped; model evidence has a shared 24,000-character budget with separate clipping markers. Ordinary article bodies that fit are sent in full, replacing the former 1,600-character per-source cap.

Blocked, restricted, non-HTML and unreadable pages retain the available RSS/search excerpt and a recorded failure. A failed retrieval or clipped recheck cannot overwrite a previously saved complete article body. Extraction runs in scheduled research and explicit Refresh fetch cycles. Ordinary reader navigation never starts research. Groq is still required for model-written summaries; ingestion and evidence storage work without it.

## Render deployment

`render.yaml` defines the current Render web service.

- service: `absurdity`
- plan: free by default
- region: Frankfurt
- build: `npm ci && npm run build`
- start: `npm run db:check && npm start`
- health check: `/api/health`
- deployed mode: `ABSURDITY_MODE=live`; the code defaults to persistent live mode unless `ABSURDITY_MODE=demo` is explicitly set (the sample `.env.example` opts local fixture testing into demo)

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

- Turso Cloud when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are configured.
- Built-in SQLite fallback for local development when Turso is absent.
- Automatic SQLite/libSQL schema initialization plus `db/migrations/001_init.sql` as the canonical schema.
- Permanent story/source/research-run records.
- `/api/stories` for the current 48-hour briefing or searchable selected-story history.
- A daily pipeline that uses Exa as primary discovery when configured, adds RSS secondary/fallback candidates, calls Exa/Tavily for independent corroboration, uses Groq only on the shortlist, persists every inspected candidate for dedupe/audit, and promotes only sufficiently supported stories.
- Provider usage and failures are recorded per research run.

Run the deep pipeline manually with:

```bash
npm run research:daily
```

For zero-idle-cost scheduling, `.github/workflows/research.yml` runs at 03:17 UTC (05:17 Johannesburg) once per day by default. Set the repository variable `ENABLE_DAILY_RESEARCH=false` only as an emergency quota kill switch; manual dispatch remains available. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as repository secrets. Groq and Exa/Tavily remain optional secrets, but Groq is required for the full editorial verification/classification layer.

Render remains the web host while Turso owns the persistent archive. Both Render and the GitHub Actions research job use the same Turso database, so the free Render filesystem is never treated as durable storage.

The Render Blueprint already sets `ABSURDITY_MODE=live`; supply the Turso and Groq secrets during deployment.

## Reader layout and QA

The current interface follows the October notebook: story titles, story text, source links directly after the article, a compact publication-date/verification footer, and small read/talk controls, all within a single viewport. The reader keeps metadata intentionally quiet while preserving the date and verification signal. See [docs/QA.md](docs/QA.md) for checks, known limits and the optional browser regression script.
