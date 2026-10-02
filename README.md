# Absurdity

Absurdity is an autonomous global absurdity desk: a news-discovery, verification, briefing and voice product designed to do editorial work before the user asks a question.

The competition thesis is: **Absurdity read the news so you did not have to — and kept the parts worth hearing.**

## Implemented in this vertical slice

- Next.js / React / TypeScript application
- Tailwind CSS styling
- polished seeded Demo Mode dashboard
- seven-story briefing using one shared domain model
- story selection and detail experience
- separate event and publication dates
- source attribution and verification notes
- Research Activity timeline
- corpus-grounded deterministic conversational fallback
- optional OpenAI grounded conversation route
- ElevenLabs narration route with browser speech fallback
- RSS-first lightweight live discovery preview
- Exa and Tavily provider abstractions
- graceful degradation when optional providers are absent

## Simulated

The seven seeded competition stories, their verification trails, and the aggregate demo statistics are controlled fixtures. They are explicitly marked as fixtures in the data and UI and use example.org source links so Demo Mode cannot be mistaken for live reporting.

## Optional providers

- OPENAI_API_KEY and OPENAI_MODEL
- ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
- EXA_API_KEY
- TAVILY_API_KEY

No provider key is required for Demo Mode.

## Architecture

- lib/types.ts — core story and briefing model
- lib/repository.ts — repository seam
- lib/agent.ts — deterministic corpus agent and safe fallback
- lib/providers/intelligence.ts — OpenAI abstraction
- lib/providers/voice.ts — ElevenLabs abstraction
- lib/providers/search.ts — Exa / Tavily abstraction
- lib/research.ts — RSS collection and deterministic triage
- app/api/chat — grounded conversation endpoint
- app/api/narrate — on-demand voice endpoint
- app/api/research — lightweight live RSS preview

The intended live pipeline is:

DISCOVER → EXTRACT → NORMALIZE → DEDUPLICATE → FILTER → CLUSTER → VERIFY → CLASSIFY → SCORE → RANK → SUMMARIZE → STORE → PRESENT → NARRATE

The current prototype implements the beginning of that pipeline for live RSS and demonstrates the complete product loop with seeded fixtures.

## Local setup

Requirements: Node.js 20.9+ and npm.

1. Run npm install.
2. Copy .env.example to .env.local if you want optional providers.
3. Run npm run dev.
4. Open http://localhost:3000.

## Demo Mode

Demo Mode exercises the same story type, dashboard, story detail surface, conversational UI, source view, verification representation, research timeline and narration controls intended for Live Mode.

## Live RSS preview

The Live RSS preview button calls /api/research. That endpoint fetches a small set of reputable RSS feeds, normalizes headline metadata, exact-deduplicates by URL, performs deterministic unusual-term triage and returns a shortlist preview.

It deliberately does not pretend that deterministic headline triage is full verification. Deep AI research and persistence remain the next implementation layer.

## OpenAI

When OPENAI_API_KEY is present, /api/chat sends a compact version of the already-researched corpus to the OpenAI Responses API and instructs the model to answer only from that corpus. If OpenAI fails, the route falls back to the deterministic agent.

## ElevenLabs

Narration is generated on demand. /api/narrate sends only the requested original Absurdity retelling to ElevenLabs. It does not turn full third-party articles into speech. If ElevenLabs is unavailable, the client falls back to browser speech synthesis where supported.

## Cost control

- RSS before paid search
- deterministic filtering before AI
- deduplication before deeper processing
- shortlist before expensive reasoning
- on-demand voice synthesis
- graceful provider fallbacks

## Reliability

The app is designed to stay usable when OpenAI or ElevenLabs is missing, one or more RSS feeds fail, search credentials are absent, or live discovery is temporarily unavailable. No fallback path should invent live facts.

## Competition demo flow

1. Open the dashboard and show the scanned → unusual → verified → selected funnel.
2. Ask “Give me the weirdest one.”
3. Open the selected story and play narration.
4. Ask “Did this actually happen?”
5. Show the fixture / verification integrity note.
6. Ask “Anything from Africa?”
7. Open Research activity and show the pre-conversation editorial trail.
8. Show sources and separate event/publication dates.
9. Optionally run Live RSS preview to demonstrate the real ingestion seam.

The key message is that conversation sits on top of prior editorial work; it is not a search box pretending to be an agent.

## Next build layer

- PostgreSQL persistence
- scheduled daily deep-research run
- model-assisted clustering and verification on shortlisted live candidates
- persisted narration cache and usage telemetry
- richer geographic coverage
- hands-free radio queue


## Render deployment

The repository includes a root-level `render.yaml` Blueprint for the current competition deployment.

Current Blueprint:

- one Node.js web service named `absurdity`
- Render free plan by default
- Frankfurt region
- Node.js pinned by `.node-version`
- build: `npm install && npm run build`
- start: `npm start`
- health check: `/api/health`
- automatic deploys only after GitHub CI checks pass
- `ABSURDITY_MODE=demo` by default so the public deployment is useful with zero provider credentials

To create the service in Render:

1. In Render, choose **New → Blueprint**.
2. Connect the GitHub repository `noob-express3000/absurdity`.
3. Select the `main` branch.
4. Review the Blueprint and apply it.
5. After the first successful deploy, use the generated `.onrender.com` URL.

Optional provider secrets should be added in the Render service environment rather than committed:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `EXA_API_KEY`
- `TAVILY_API_KEY`

The application remains functional in Demo Mode if every optional provider is missing.

PostgreSQL and the once-daily research cron job are intentionally not provisioned yet because the current vertical slice does not depend on them. They should be added to the Blueprint when persistence and the scheduled deep-research command are implemented, rather than creating idle paid infrastructure prematurely.
