"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { demoBriefing } from "@/lib/demo-data";
import type { Story } from "@/lib/types";

type Tab = "home" | "favorites" | "history";
type HistoryRange = "2d" | "7d" | "30d" | "all";
type VoiceState = "idle" | "loading" | "playing";

const FAVORITES_KEY = "absurdity:favorites:v1";
const DISMISSED_KEY = "absurdity:dismissed:v1";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function parseStoredIds(key: string) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function formatDate(value: string, includeTime = false) {
  try {
    return new Intl.DateTimeFormat("en", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function storyMatches(story: Story, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [
    story.title,
    story.shortTitle,
    story.summary,
    story.detailedSummary,
    story.country,
    story.region,
    story.category,
    story.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function demoClock() {
  if (demoBriefing.mode !== "demo") return Date.now();
  return Math.max(...demoBriefing.stories.map((story) => new Date(story.publicationDate).getTime()));
}

export default function Home() {
  const stories = demoBriefing.stories;
  const [tab, setTab] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState(stories[0].id);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const [hydrated, setHydrated] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("Say “next”, “favorite”, “dismiss”, “read”, “history” or “home”.");
  const anchorTime = useMemo(demoClock, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const gestureRef = useRef<{ id: string; x: number } | null>(null);

  useEffect(() => {
    setFavorites(parseStoredIds(FAVORITES_KEY));
    setDismissed(parseStoredIds(DISMISSED_KEY));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
  }, [dismissed, hydrated]);

  useEffect(() => {
    return () => {
      keepListeningRef.current = false;
      recognitionRef.current?.stop?.();
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const homeStories = useMemo(
    () =>
      stories.filter(
        (story) =>
          anchorTime - new Date(story.publicationDate).getTime() <= TWO_DAYS_MS &&
          !dismissed.includes(story.id),
      ),
    [anchorTime, dismissed, stories],
  );

  const favoriteStories = useMemo(
    () => stories.filter((story) => favorites.includes(story.id)),
    [favorites, stories],
  );

  const historyStories = useMemo(() => {
    if (historyRange === "all") return stories;
    const days = historyRange === "2d" ? 2 : historyRange === "7d" ? 7 : 30;
    const cutoff = anchorTime - days * 24 * 60 * 60 * 1000;
    return stories.filter((story) => new Date(story.publicationDate).getTime() >= cutoff);
  }, [anchorTime, historyRange, stories]);

  const baseStories =
    tab === "home" ? homeStories : tab === "favorites" ? favoriteStories : historyStories;

  const visibleStories = useMemo(
    () => baseStories.filter((story) => storyMatches(story, query)),
    [baseStories, query],
  );

  const selected = stories.find((story) => story.id === selectedId) ?? stories[0];

  useEffect(() => {
    if (visibleStories.length && !visibleStories.some((story) => story.id === selectedId)) {
      setSelectedId(visibleStories[0].id);
    }
  }, [selectedId, visibleStories]);

  function stopNarration() {
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    setVoiceState("idle");
  }

  function browserSpeak(text: string) {
    if (!("speechSynthesis" in window)) {
      setVoiceState("idle");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => setVoiceState("idle");
    utterance.onerror = () => setVoiceState("idle");
    setVoiceState("playing");
    window.speechSynthesis.speak(utterance);
  }

  async function narrate() {
    if (voiceState === "playing" || voiceState === "loading") {
      stopNarration();
      return;
    }

    setVoiceState("loading");
    const text = `${selected.title}. ${selected.detailedSummary}`;

    try {
      const response = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        browserSpeak(text);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setVoiceState("idle");
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setVoiceState("idle");
        URL.revokeObjectURL(url);
      };
      setVoiceState("playing");
      await audio.play();
    } catch {
      browserSpeak(text);
    }
  }

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((storyId) => storyId !== id) : [...current, id],
    );
  }

  function dismissStory(id: string) {
    setDismissed((current) => (current.includes(id) ? current : [...current, id]));

    if (tab === "home" && selectedId === id) {
      const next = homeStories.find((story) => story.id !== id);
      if (next) setSelectedId(next.id);
    }
  }

  function restoreDismissed() {
    setDismissed([]);
  }

  function selectAdjacent(direction: 1 | -1) {
    if (!visibleStories.length) return;
    const currentIndex = visibleStories.findIndex((story) => story.id === selectedId);
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + visibleStories.length) % visibleStories.length;
    setSelectedId(visibleStories[nextIndex].id);
    stopNarration();
  }

  function onStoryPointerDown(storyId: string, event: ReactPointerEvent<HTMLDivElement>) {
    gestureRef.current = { id: storyId, x: event.clientX };
  }

  function onStoryPointerUp(storyId: string, event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (tab !== "home" || !gesture || gesture.id !== storyId) return;
    if (gesture.x - event.clientX > 72) dismissStory(storyId);
  }

  function stopHandsFree() {
    keepListeningRef.current = false;
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  }

  function handleVoiceCommand(raw: string) {
    const command = raw.toLowerCase();
    setVoiceHint(`Heard: “${raw}”`);

    if (command.includes("next")) return selectAdjacent(1);
    if (command.includes("previous") || command.includes("back")) return selectAdjacent(-1);
    if (command.includes("favorite") || command.includes("save")) return toggleFavorite(selected.id);
    if (command.includes("dismiss") || command.includes("skip")) return dismissStory(selected.id);
    if (command.includes("read") || command.includes("speak")) return void narrate();
    if (command.includes("favorites")) return changeTab("favorites");
    if (command.includes("history")) return changeTab("history");
    if (command.includes("home") || command.includes("new stories")) return changeTab("home");
    if (command.includes("stop listening")) return stopHandsFree();
    if (command.includes("stop")) return stopNarration();

    setVoiceHint("Command not recognized. Try next, previous, favorite, dismiss, read, history or home.");
  }

  function startHandsFree() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceHint("Hands-free navigation is not supported by this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (transcript) handleVoiceCommand(transcript);
    };
    recognition.onerror = (event: any) => {
      if (event?.error !== "no-speech") {
        setVoiceHint(`Voice navigation error: ${event?.error ?? "unknown error"}.`);
      }
    };
    recognition.onend = () => {
      if (!keepListeningRef.current) {
        setListening(false);
        return;
      }
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    };

    keepListeningRef.current = true;
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setVoiceHint("Hands-free navigation is listening.");
  }

  function changeTab(nextTab: Tab) {
    setTab(nextTab);
    setQuery("");
    stopNarration();
  }

  const tabTitle =
    tab === "home" ? "New stories" : tab === "favorites" ? "Favorites" : "History";

  const emptyMessage =
    tab === "home"
      ? dismissed.length
        ? "You cleared the current feed. Restore dismissed stories to review it again."
        : "No stories landed in the current two-day window."
      : tab === "favorites"
        ? "No favorites yet. Save a story with the star."
        : "No archived stories match this search and timeframe.";

  return (
    <main className="min-h-screen px-3 py-3 md:px-6 md:py-5">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-4 flex flex-col gap-4 border-b border-[var(--line)] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ink)] text-lg font-black text-white">
              A
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-[-0.04em]">Absurdity</h1>
              <p className="text-sm text-[var(--muted)]">
                The world&apos;s strange stories, already sorted.
              </p>
            </div>
          </div>

          <nav className="flex w-full gap-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-1 lg:w-auto">
            {(
              [
                ["home", "New stories"],
                ["favorites", `Favorites ${favorites.length ? `(${favorites.length})` : ""}`],
                ["history", "History"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => changeTab(id)}
                className={
                  "min-w-0 flex-1 rounded-lg px-4 py-2 text-sm font-bold transition lg:flex-none " +
                  (tab === id
                    ? "bg-[var(--ink)] text-white"
                    : "text-[var(--muted)] hover:bg-[var(--soft)]")
                }
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs font-bold">
              DEMO
            </span>
            <button
              onClick={listening ? stopHandsFree : startHandsFree}
              className={
                "rounded-full px-3 py-2 text-xs font-bold transition " +
                (listening
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--line)] bg-[var(--paper)]")
              }
              title={voiceHint}
            >
              {listening ? "Listening…" : "Hands-free"}
            </button>
          </div>
        </header>

        <section className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-black">{tabTitle}</span>
            <span className="ml-2 text-sm text-[var(--muted)]">
              {visibleStories.length} {visibleStories.length === 1 ? "story" : "stories"}
            </span>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {tab !== "home" && (
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, place, category…"
                className="min-w-[220px] rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)]"
              />
            )}
            {tab === "history" && (
              <select
                value={historyRange}
                onChange={(event) => setHistoryRange(event.target.value as HistoryRange)}
                className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-bold outline-none"
              >
                <option value="2d">Last 2 days</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All history</option>
              </select>
            )}
            {tab === "home" && dismissed.length > 0 && (
              <button
                onClick={restoreDismissed}
                className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-bold"
              >
                Restore dismissed ({dismissed.length})
              </button>
            )}
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="abs-card overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <div className="abs-mono text-[10px] text-[var(--muted)]">
                {tab === "home"
                  ? "48-hour feed"
                  : tab === "favorites"
                    ? "saved stories"
                    : "permanent archive"}
              </div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {tab === "home" ? "Swipe left or use × to dismiss." : "Tap a title to read."}
              </div>
            </div>

            <div className="abs-scrollbar story-list overflow-y-auto">
              {visibleStories.length ? (
                visibleStories.map((story) => {
                  const isSelected = selected.id === story.id;
                  const isFavorite = favorites.includes(story.id);

                  return (
                    <div
                      key={story.id}
                      onPointerDown={(event) => onStoryPointerDown(story.id, event)}
                      onPointerUp={(event) => onStoryPointerUp(story.id, event)}
                      className={
                        "group border-b border-[var(--line)] last:border-b-0 " +
                        (isSelected ? "bg-[var(--soft)]" : "bg-[var(--paper)] hover:bg-[#f8f8f5]")
                      }
                    >
                      <button
                        onClick={() => {
                          setSelectedId(story.id);
                          stopNarration();
                        }}
                        className="block w-full px-4 pb-2 pt-4 text-left"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="abs-mono text-[10px] text-[var(--accent-dark)]">
                            #{story.rank} · {story.country}
                          </span>
                          <span className="text-[10px] font-bold text-[var(--muted)]">
                            {formatDate(story.publicationDate)}
                          </span>
                        </div>
                        <h2 className="text-[15px] font-black leading-5 tracking-[-0.02em]">
                          {story.title}
                        </h2>
                      </button>

                      <div className="flex items-center justify-between px-3 pb-3">
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[var(--muted)]">
                          {story.category}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleFavorite(story.id)}
                            className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-white"
                            aria-label={isFavorite ? "Remove favorite" : "Favorite story"}
                            title={isFavorite ? "Remove favorite" : "Favorite"}
                          >
                            {isFavorite ? "★" : "☆"}
                          </button>
                          {tab === "home" && (
                            <button
                              onClick={() => dismissStory(story.id)}
                              className="grid h-8 w-8 place-items-center rounded-lg text-base hover:bg-white"
                              aria-label="Dismiss story"
                              title="Dismiss"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-sm leading-6 text-[var(--muted)]">{emptyMessage}</div>
              )}
            </div>
          </aside>

          <article className="abs-card flex min-h-[680px] flex-col overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--line)] px-5 py-4 md:px-7">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-bold text-white">
                    {selected.country}
                  </span>
                  <span className="rounded-full bg-[var(--soft)] px-3 py-1.5 text-[11px] font-bold">
                    {selected.category}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    Published {formatDate(selected.publicationDate, true)}
                  </span>
                </div>
                <button
                  onClick={() => toggleFavorite(selected.id)}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
                >
                  {favorites.includes(selected.id) ? "★ Favorited" : "☆ Favorite"}
                </button>
              </div>
              <h2 className="max-w-5xl text-3xl font-black leading-[1.05] tracking-[-0.045em] md:text-5xl">
                {selected.title}
              </h2>
            </div>

            <div className="abs-scrollbar reader-scroll flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
              <section className="mb-6">
                <div className="abs-mono text-[10px] text-[var(--muted)]">Sources</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-bold hover:border-[var(--ink)]"
                    >
                      {source.publisher} ↗
                    </a>
                  ))}
                </div>
              </section>

              <section className="max-w-4xl">
                <div className="abs-mono text-[10px] text-[var(--muted)]">Story</div>
                <p className="mt-3 text-lg leading-8 text-[#282823] md:text-xl md:leading-9">
                  {selected.detailedSummary}
                </p>
              </section>

              <section className="mt-8 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-[var(--line)] p-4">
                  <div className="abs-mono text-[10px] text-[var(--muted)]">
                    Why it made the cut
                  </div>
                  <p className="mt-2 text-sm font-bold leading-6">{selected.whyItsWeird}</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] p-4">
                  <div className="abs-mono text-[10px] text-[var(--muted)]">Verification</div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {selected.verificationNotes}
                  </p>
                </div>
              </section>

              <section className="mt-6 grid gap-3 border-t border-[var(--line)] pt-5 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-[var(--muted)]">Event date</div>
                  <div className="mt-1 font-bold">{formatDate(selected.eventDate, true)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">Confidence</div>
                  <div className="mt-1 font-bold capitalize">{selected.confidence}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)]">Region</div>
                  <div className="mt-1 font-bold">{selected.region}</div>
                </div>
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--paper)] px-4 py-3 md:px-6">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectAdjacent(-1)}
                  disabled={!visibleStories.length}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => selectAdjacent(1)}
                  disabled={!visibleStories.length}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold disabled:opacity-40"
                >
                  Next →
                </button>
                {tab === "home" && (
                  <button
                    onClick={() => dismissStory(selected.id)}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
                  >
                    Dismiss
                  </button>
                )}
              </div>

              <button
                onClick={narrate}
                className="rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-black text-white"
              >
                {voiceState === "loading"
                  ? "Preparing…"
                  : voiceState === "playing"
                    ? "■ Stop"
                    : "◉ Speak"}
              </button>
            </div>
          </article>
        </section>

        <footer className="mt-3 flex flex-col gap-1 px-1 text-xs text-[var(--muted)] md:flex-row md:items-center md:justify-between">
          <span>
            {demoBriefing.mode === "demo"
              ? "Demo clock follows the newest fixture so the 48-hour feed remains testable."
              : "Home only shows stories published in the last 48 hours."}
          </span>
          <span>{voiceHint}</span>
        </footer>
      </div>
    </main>
  );
}
