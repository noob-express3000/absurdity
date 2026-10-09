# Devpost Submission Draft

## Project name

Absurdity

## Tagline

**An agentic system that finds, verifies, and narrates some of the strangest stories on the internet.**

## Primary track

**Alexa+ — Simulated Alexa+ experience**

Absurdity uses the officially permitted simulated Alexa+ path. The browser experience represents the conversational interaction layer while the underlying research, verification, persistence, archive search, and narration workflows are real.

## Project description

Absurdity is an agentic strange-news system that hunts for bizarre real-world stories, verifies the strongest candidates, remembers what it has already found, and turns the result into a conversational briefing that can be read or narrated aloud.

Most news products begin after the user already knows what to search for. Absurdity starts earlier. Its research workflow actively searches for high-surprise events across categories such as bizarre local incidents, animals where they should not be, failed crimes, bureaucratic mistakes, unusual court cases, transport chaos, mistaken identities, strange discoveries, odd competitions, technology failures, and improbable coincidences.

Discovery is intentionally broad, but publication is deliberately strict. Exa is the primary discovery and corroboration layer, with RSS as secondary coverage. Candidates are normalized, freshness-filtered, deduplicated, clustered into events, checked against the existing archive, and then investigated using source extraction and corroboration. Groq evaluates the evidence, classifies the event, scores its absurdity and credibility, and decides whether it is strong enough to promote into the reader. Low-confidence or merely quirky items do not become published stories.

Selected stories are stored in Turso as a permanent archive. Stories from the most recent seven days appear in Home; older stories naturally become History without being duplicated or deleted. Users can search that accumulated archive conversationally, ask follow-up questions about the current story, move between stories by voice, save favorites locally, and request narration through ElevenLabs.

Absurdity also runs autonomous research cycles. A scheduled GitHub Action calls the production research endpoint daily, while users can explicitly request a refresh from the interface. Research is protected by a shared database lease to prevent overlapping runs and uses a persistent heartbeat so interrupted workers can be detected and recovered instead of leaving the UI spinning indefinitely.

This submission uses the simulated Alexa+ experience route. The web interface is not presented as a direct Alexa+ integration. It demonstrates how Absurdity could behave as an Alexa+ experience: conversation is central, voice can drive navigation and story exploration, visual content complements the spoken interaction, state persists across research cycles, and the system invokes real tools rather than acting as a single-turn chatbot.

## Inspiration

The internet produces genuinely ridiculous real stories every day, but finding the good ones is surprisingly manual. Search engines require you to know what to ask for, social feeds mix real reporting with recycled posts and jokes, and "weird news" pages often provide little indication of how well a story is supported.

The idea behind Absurdity was to reverse that interaction. Instead of asking a user to hunt for strange stories, the system should do the hunting, checking, remembering, and briefing for them.

Alexa+ is a natural interaction model for that idea. Strange-news discovery works well as something you can ask for casually, continue exploring through follow-up questions, and listen to without needing to sit in front of a traditional news dashboard.

## What it does

Absurdity can:

- autonomously discover recent high-surprise real-world events;
- combine Exa search with secondary RSS coverage;
- remove duplicates and cluster multiple reports of the same event;
- extract readable article bodies while respecting publisher restrictions;
- search for independent corroboration;
- use Groq to verify, classify, summarize, and score candidates;
- reject low-confidence or insufficiently absurd candidates;
- store selected stories and their evidence trail in a persistent Turso archive;
- organize the archive into a seven-day Home window plus permanent History;
- answer conversational questions using only the researched archive;
- search older stories by topic, location, category, or keywords;
- navigate hands-free with voice commands;
- narrate selected stories with ElevenLabs;
- run research manually or from a daily GitHub Actions schedule;
- recover cleanly from interrupted research workers.

## How we built it

The production application is a Next.js/TypeScript web app hosted on Render.

The research pipeline is:

```
Exa + RSS discovery
        ↓
freshness filtering
        ↓
normalization + deduplication
        ↓
event clustering
        ↓
archive deduplication
        ↓
corroboration search
        ↓
article extraction
        ↓
Groq verification + editorial analysis
        ↓
ranking + persistence
        ↓
conversation + narration
```

**Exa** provides primary web discovery and corroboration. **RSS** provides secondary/fallback coverage. **Mozilla Readability + JSDOM** extract article bodies. **Groq** performs evidence-grounded verification/editorial reasoning and powers conversational interpretation against the stored archive. **Turso** stores stories, source metadata, evidence, research runs, leases, and worker heartbeats. **ElevenLabs** provides narration. **Render** hosts the production app. **GitHub Actions** provides the daily scheduler.

The production reader never silently replaces missing live data with demo fixtures. Browser refreshes only reload the archive; they do not spend provider calls. Explicit refresh requests start research.

## Technical highlights

- Primary Exa discovery uses 12 high-surprise search lenses with freshness bounds and publisher diversity.
- Up to 18 event candidates can be investigated in a research cycle.
- Article ingestion rejects private/non-unicast addresses, unsafe protocols, arbitrary ports, suspicious redirects, oversized responses, non-HTML payloads, compressed responses, and restricted pages.
- Research runs use a database lease to prevent overlap.
- Heartbeats allow interrupted workers to be detected after server restarts instead of leaving stale "running" state.
- Previously selected stories are deduplicated before expensive extraction/model work.
- Story evidence and full extracted source bodies stay server-side and are not exposed in the public reader payload.
- The live production deployment requires Turso and will not silently fall back to local SQLite.
- The repository includes regression tests, type checking, production builds, browser smoke tests, and reliability tests.

## Challenges we ran into

### Making discovery absurd without making verification sloppy

Broad strange-news searches return a lot of material that is only mildly quirky. Tightening the filter too early also risks missing genuinely strange events whose headlines use ordinary language.

The final approach separates discovery from publication: discovery is intentionally aggressive, while verification remains conservative. The system searches a wide range of absurdity-oriented lenses, then lets evidence quality and editorial analysis decide what survives.

### Persisting autonomous research on a free web service

Research can take several minutes because candidates are searched, extracted, corroborated, analyzed, and persisted. A normal web-service process can restart during that work.

We added database-backed research leases and later a research heartbeat. The lease prevents overlapping cycles; the heartbeat lets a replacement process recognize an interrupted worker and fail the stale run quickly instead of leaving users watching an indefinite spinner.

### Building for Alexa+ without public Alexa+ developer tooling

Hackathon participants do not have access to the gated Alexa+ Add-on toolkit or official simulator. The hackathon explicitly permits a simulated Alexa+ experience, so Absurdity uses its production web interface as that simulation while keeping the underlying workflows real.

## Accomplishments

The part I am most satisfied with is that Absurdity is not a generated-news mockup. The production reader is backed by a persistent real research pipeline.

A refresh can trigger actual discovery, source retrieval, corroboration, model-assisted verification, ranking, and storage. The archive survives sessions and grows over time. Conversation operates on that researched corpus instead of silently going back to the open web, and narration is a separate real tool invocation.

The project also developed a fairly defensive reliability layer for a hackathon build: source-fetch SSRF protections, strict live/demo separation, durable research state, deduplication before provider spend, Turso startup validation, health separation, and automated regression/smoke testing.

## What we learned

The biggest lesson was that an agentic product does not need every step to be an LLM call. Absurdity became more reliable when deterministic code owned the parts that should be deterministic — scheduling, freshness, URL safety, deduplication, clustering, state transitions, persistence, and navigation — while the model handled the genuinely ambiguous work of interpreting evidence and conversation.

We also learned that discovery quality and verification quality are different optimization problems. The best version of Absurdity searches aggressively and publishes conservatively.

## What's next

The next step would be turning the simulated Alexa+ interaction into a native Alexa+ integration once the relevant developer tooling becomes generally available.

Product-wise, the archive could support personalized briefing preferences, richer geographic exploration, user-defined absurdity categories, multilingual narration, and additional primary-source connectors. The same research architecture could also support other autonomous niche briefings where discovery and verification matter more than conventional keyword search.

## Testing instructions

**Live app:** https://absurdity.onrender.com

No account or login is required.

Recommended flow:

1. Open Home and select a live story.
2. Inspect its sources and verification information.
3. Ask a conversational question about the selected story.
4. Search the saved archive by subject or geography.
5. Start narration.
6. Trigger an explicit story refresh to demonstrate the autonomous research cycle.
7. Open History to show that older selected stories remain available.

A full research cycle can take several minutes because it performs real search, source retrieval, corroboration, verification, and persistence. The interface remains usable while research is running.

## Built with

- Next.js
- TypeScript
- React
- Exa
- Groq
- ElevenLabs
- Turso
- Mozilla Readability
- JSDOM
- Render
- GitHub Actions
- RSS

## Repository

https://github.com/noob-express3000/absurdity

## Open source

Absurdity is released under the MIT License.

## Open Source Mini Challenge working notes

GitHub username: **noob-express3000**

Repository / contribution URL:

https://github.com/noob-express3000/absurdity

Draft description:

> Absurdity is a new MIT-licensed agentic research and narration system created during the hackathon window. The repository contains the complete production application, autonomous research pipeline, provider integrations, persistence layer, safety controls, deployment configuration, scheduler, and automated tests. The project demonstrates a reusable architecture for combining aggressive web discovery with conservative evidence-grounded publication, persistent research state, and conversational access to a growing archive.

Before the final submission, verify that the project itself satisfies the organizer's interpretation of the Open Source mini-challenge's "additional open-source project" wording.
