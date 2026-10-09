# Devpost Friction Log Draft

These entries are written for the optional Devpost friction-log section. Keep only entries that accurately reflect the final submission experience.

## 1. Determining the supported Alexa+ development path

**Task attempted:** Determine how a hackathon participant can build and test an Alexa+ experience.

**Steps taken:** Reviewed the Alexa+ setup material, hackathon rules, FAQs, and organizer clarifications to determine whether the Add-on toolkit, CLI, and official simulator were available.

**Expected result:** A single obvious development path from the track page to a participant-accessible toolchain or simulator.

**Actual result:** The Alexa+ Add-on developer tools and official simulator are limited to select partners. Hackathon participants instead need to use the officially permitted simulated-experience path, a self-hosted MCP server, or an Agent Skill depending on their access and implementation.

**Severity:** Important

**Workaround:** Used the explicitly permitted simulated Alexa+ route and built the simulation as a real production web experience backed by real agentic workflows.

**Actionable suggestion:** Put a prominent "Hackathon participants do not receive Alexa+ Add-on toolkit/simulator access" notice at the top of every relevant Alexa+ setup page, immediately followed by links to the supported hackathon paths and a minimal simulation example.

---

## 2. Validating an Alexa+-appropriate experience without the official simulator

**Task attempted:** Validate whether the interaction model felt appropriate for Alexa+.

**Steps taken:** Designed a voice-capable browser interaction, separated local navigation from conversational reasoning, added spoken narration, and reviewed organizer guidance on what constitutes an acceptable simulated experience.

**Expected result:** A public simulator or reference harness that could be used to validate conversation, visual presentation, and multimodal behavior against the target platform.

**Actual result:** The official Alexa+ simulator is not available to hackathon participants, so platform-level validation has to be approximated through a custom front end.

**Severity:** Important

**Workaround:** Used a browser-based simulation and kept the interaction model voice-friendly, conversational, persistent, and tool-driven rather than trying to imitate inaccessible Alexa internals.

**Actionable suggestion:** Provide hackathon participants with a lightweight public mock host or reference simulator that accepts simulated tool responses and renders representative Alexa+ conversational/visual states without exposing private preview tooling.

---

## 3. Long-running research on a restartable web service

**Task attempted:** Run a multi-minute autonomous research pipeline from a web application.

**Steps taken:** Started research asynchronously from the production route and tracked the run in the database.

**Expected result:** Once started, a run would either complete or clearly fail.

**Actual result:** A web-service redeploy can terminate the process that owns the work while the database record still says the run is active.

**Severity:** Important

**Workaround:** Added a shared database lease plus a persistent research heartbeat. If heartbeats stop after a restart, the stale worker is detected and the UI reports the interruption instead of spinning until the full lease timeout.

**Actionable suggestion:** For platforms aimed at agentic workloads, surface a simple durable-task primitive or clearer first-party pattern for work that outlives an HTTP request.

---

## 4. Transient database/network failure during archive reads

**Task attempted:** Keep the live story archive available while using a remote SQLite-compatible database.

**Steps taken:** Used Turso as production persistence and queried it from the Render-hosted Next.js service.

**Expected result:** Archive reads should normally return without affecting the reader.

**Actual result:** A transient closed socket caused a story API fetch to fail even though the service itself remained healthy.

**Severity:** Moderate

**Workaround:** Separated provider-independent liveness from deeper health checks, kept already loaded browser data stale-while-revalidate during passive refreshes, and avoided replacing live data with fixtures on failure.

**Actionable suggestion:** Client libraries should expose more explicit retry guidance and structured transient/permanent error classification so applications can apply the correct recovery policy without string matching.

---

## 5. Scheduling research without a paid cron service

**Task attempted:** Trigger one autonomous research cycle per day while keeping the deployment on a free web-service plan.

**Steps taken:** Evaluated in-process timers and the hosting provider's cron offering.

**Expected result:** A small daily task could be scheduled alongside the free web service.

**Actual result:** A durable in-process timer is not reliable across restarts/sleep, while the hosting provider's dedicated cron product has a minimum monthly charge.

**Severity:** Moderate

**Workaround:** Used GitHub Actions as the scheduler. It only calls the production research endpoint; the Render app still owns provider credentials, research logic, persistence, and locking.

**Actionable suggestion:** Provide a low-frequency free scheduler allowance for existing free web services, or a native "HTTP ping on schedule" feature that does not require a separate paid service.

---

## 6. Polling through transient 503 responses

**Task attempted:** Have the GitHub Actions scheduler wait for a research run to reach a terminal state.

**Steps taken:** Polled the production status endpoint with curl retries.

**Expected result:** A transient 503 would be retried and the subsequent JSON response would parse normally.

**Actual result:** Using `curl --fail-with-body` with retries could place a transient error body and a later successful JSON body into the same captured output, causing a JSON "Extra data" parse error.

**Severity:** Moderate

**Workaround:** Switched polling to `curl --fail`, which suppresses transient failure bodies before retrying so the captured response contains only the successful JSON document.

**Actionable suggestion:** Retry examples in scheduler/deployment documentation should explicitly warn about response-body concatenation when command substitution captures curl output across retries.
