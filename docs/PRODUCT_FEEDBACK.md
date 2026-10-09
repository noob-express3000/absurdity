# Devpost Product Feedback Draft

## Alexa+ / simulated experience path

**Used for:** The primary hackathon track. Absurdity is submitted through the officially permitted simulated Alexa+ experience route.

**What worked well:** The simulated-experience option makes it possible to build a credible Alexa+-style product even though the gated Add-on toolkit and official simulator are unavailable to hackathon participants. Organizer clarifications were useful once found and made it clear that a custom web UI, voice interaction, and real backend workflows are acceptable.

**What needs work:** The biggest issue is discoverability. Individual Alexa+ setup pages can make the developer tooling look accessible even though the Add-on toolkit, CLI, and simulator are limited to select partners. That creates unnecessary uncertainty about what participants are actually expected to build.

**Onboarding:** Confusing at first because the public documentation and the hackathon-access reality are not obvious from one place. The hackathon FAQ and organizer responses eventually made the simulated route clear.

**Would I build with it again?** Yes. The conversational, multimodal model fits Absurdity well. I would especially want to turn the simulated experience into a native integration when public Alexa+ developer tooling becomes available.

---

## Exa

**Used for:** Primary web discovery and independent corroboration searches.

**What worked well:** Freshness-bounded news search, semantic query flexibility, publication dates, domain controls, and text snippets made Exa a strong fit for an autonomous discovery pipeline. It let Absurdity search multiple "absurdity lenses" rather than depend only on fixed feeds.

**What needs work:** Search quality varies with wording and can concentrate around a small number of publishers, so the application still needs diversity controls, freshness checks, deduplication, and an editorial stage. More transparent ranking/debug information would make agentic search pipelines easier to tune.

**Onboarding:** Straightforward. The HTTP API was easy to integrate into the existing TypeScript provider abstraction.

**Would I build with it again?** Yes. It is the most important part of Absurdity's open-web discovery layer.

---

## Groq

**Used for:** Evidence-grounded candidate analysis, verification/classification, summarization, and conversational interpretation of the stored archive.

**What worked well:** Fast inference made it practical to analyze multiple candidates in one research cycle and still keep the product interactive. Using the same provider for editorial reasoning and conversation simplified the architecture.

**What needs work:** Model/provider requests can still fail or return output that needs validation, so production use requires strict schema checking, deterministic fallbacks, timeouts, and conservative publication rules. More first-class structured-output reliability would reduce defensive parsing code.

**Onboarding:** Easy. The API shape was familiar and quick to integrate.

**Would I build with it again?** Yes. The latency/capability balance worked well for this project.

---

## ElevenLabs

**Used for:** Story narration.

**What worked well:** Voice quality is strong enough that the narration feels like a real product feature rather than a browser demo.

**What needs work:** Configuration errors around voice/API settings are easy to encounter and the application needs a clear fallback path when narration is unavailable. More actionable error responses would improve debugging.

**Onboarding:** Reasonably straightforward once the API key and voice configuration were correct.

**Would I build with it again?** Yes, especially for longer-form narration where browser speech synthesis is noticeably less natural.

---

## Turso

**Used for:** Persistent relational storage for stories, sources, extracted evidence metadata, research runs, research leases, and worker heartbeats.

**What worked well:** SQLite semantics kept the data model simple while still providing a hosted database suitable for the Render deployment. It was easy to use the same repository pattern locally and in production.

**What needs work:** We encountered a transient socket-close failure from the application process. That was recoverable, but applications need good retry and stale-while-revalidate behavior around remote database access.

**Onboarding:** Good. Moving from local SQLite concepts to hosted Turso required very little conceptual overhead.

**Would I build with it again?** Yes. It fits small agentic applications that want relational state without operating a full database server.

---

## Render

**Used for:** Production hosting of the Next.js application and API.

**What worked well:** Git-based deployment, environment variables, health checks, and a simple Node service model made it fast to ship a live production URL.

**What needs work:** Free web services are restartable and are not a durable background-job environment. Dedicated cron jobs are also not included free, which matters for small autonomous agents that only need one lightweight scheduled trigger per day.

**Onboarding:** Very easy for the web application itself.

**Would I build with it again?** Yes for the web service, but I would pair it with an external scheduler or durable worker mechanism for long-running jobs.

---

## GitHub Actions

**Used for:** Daily scheduled trigger of the production research endpoint and CI.

**What worked well:** It provided a simple, no-additional-hosting-cost scheduler and a reliable place to run regression tests, type checking, production builds, and smoke tests.

**What needs work:** Long polling against an external free service needs careful retry handling. Our first implementation exposed an interaction between curl retries and captured error bodies, which we fixed by suppressing transient failure bodies.

**Onboarding:** Straightforward.

**Would I build with it again?** Yes. It was a good fit for low-frequency scheduling and CI.

---

## Mozilla Readability + JSDOM

**Used for:** Extracting readable article text from fetched publisher pages.

**What worked well:** Readability provided a strong generic extraction layer without requiring publisher-specific scrapers.

**What needs work:** Real news sites vary widely in markup, access restrictions, redirects, and anti-bot behavior, so extraction still needs strict timeouts, size limits, SSRF protection, content-type validation, and excerpt fallback behavior.

**Onboarding:** Easy, but production hardening required much more work than basic extraction.

**Would I build with it again?** Yes. It is a useful baseline for article extraction when combined with strict network and content safety controls.

---

## Next.js / React / TypeScript

**Used for:** The production web application, API routes, UI, and shared type-safe domain logic.

**What worked well:** The application and API could live in one codebase, which kept the submission architecture compact. TypeScript helped keep story, research, and conversation state consistent across the client and server.

**What needs work:** Long-running background work should not be treated as if it has the same lifecycle as a normal request/response route, especially on restartable hosting. We solved this at the application level with database-backed leases and heartbeats.

**Onboarding:** Familiar and fast.

**Would I build with it again?** Yes.
