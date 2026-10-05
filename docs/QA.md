# QA: notebook reader and reliability fixes

## Product layout

The October notebook defines a simple interface: New stories, Favorites and History; a scrollable title list beside a scrollable story; source links after the article; and a speak button for navigation. The homepage covers the current 48 hours, with older stories retained in History.

The reader now follows that layout. Per-story category badges, ranked metadata, repeated instructions, large verification cards and the promotional subtitle have been removed from the default view. Story details, standalone dates, confidence, selection reasoning and verification sections have been removed entirely from the reader. Only the article title is a visible heading. Source links follow the article inside the scrolling reading pane. Small read/talk controls stay at its bottom-right. Manual search/date fields, story counts and repeated favorite controls have been removed. Requested navigation instructions search stored stories; they never invoke discovery. A compact typed instruction box appears only when speech recognition is unavailable or microphone access is denied. On phones the title list sits above the reading pane within the viewport. The visual polish uses a soft off-white canvas, a restrained rounded frame, an inset selected row, system serif article typography and consistent SVG controls. It adds no fonts, requests or dependencies.

## Verified

- Production build and TypeScript.
- 17 automated regressions: archive/search with combined criteria and date bounds, navigation parsing, Johannesburg publication days, API validation, demo grounding, narration fallback, healthy and degraded database readiness, SQLite story/source/research persistence, 48-hour and future-date filtering, permanent selected history, research-run telemetry, Groq response validation and provider failures.
- Browser checks at 1366×768, 1280×720, 360×640, 360×800 and 844×390 in Africa/Johannesburg: repeated voice next commands, favorite/favorites distinction, favorite and dismissal reload persistence, requested geography/category/older/favorites search, typed navigation after microphone denial, dismiss/restore, source links, browser speech fallback, cancellation during narration preparation and microphone denial.
- No page errors, page-level scrolling or horizontal overflow in those browser checks.

Speech recognition and synthesis were stubbed for repeatable control tests. Real microphone recognition and audible playback still require device testing. Live Groq/ElevenLabs/Turso calls, the deployed Render URL, and actual scheduled RSS research were not exercised with production credentials.

## Run checks

```bash
npm ci
npm test
npm run typecheck
npm run build
npm start
```

For the optional browser regression script, install Playwright locally without changing application dependencies:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser-smoke.mjs
```

Run against a separate demo database and demo server. The script changes only its fresh browser profile. Set `QA_BASE_URL` for a different server, `QA_CHROMIUM_PATH` for an existing Chromium executable, and optionally `QA_SCREENSHOT_DIR` to capture screenshots.

## Hosting region

`region: frankfurt` selects where the Render backend runs. It does not restrict the public site's visitors to Europe. This configuration runs one regional backend, rather than replicated compute in multiple regions.

## Reader previews

![Desktop reader](reader-desktop.png)

![Phone reader](reader-mobile.png)
