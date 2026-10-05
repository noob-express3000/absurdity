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

function formatDate(value: string, includeTime = false, clientReady = false) {
  try {
    // SSR and the first client render must agree before applying browser locale/timezone.
    if (!clientReady) {
      const iso = new Date(value).toISOString();
      return includeTime ? iso.slice(0, 16).replace("T", " ") + " UTC" : iso.slice(0, 10);
    }
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
  const [remoteStories, setRemoteStories] = useState<Story[] | null>(null);
  const [dataMode, setDataMode] = useState<"demo" | "live">("demo");
  const stories = remoteStories?.length ? remoteStories : demoBriefing.stories;
  const usingLive = dataMode === "live" && Boolean(remoteStories?.length);
  const [tab, setTab] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState(demoBriefing.stories[0].id);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const [historyDate, setHistoryDate] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("Say “next”, “favorite”, “dismiss”, “read”, “history” or “home”.");
  const anchorTime = useMemo(() => (usingLive ? Date.now() : demoClock()), [usingLive]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const commandHandlerRef = useRef<(command: string) => void>(() => {});
  const narrationRequestRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const gestureRef = useRef<{ id: string; x: number } | null>(null);

  useEffect(() => {
    setFavorites(parseStoredIds(FAVORITES_KEY));
    setDismissed(parseStoredIds(DISMISSED_KEY));
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/stories?scope=history&limit=500", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Story archive request failed.");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const mode = payload?.mode === "live" ? "live" : "demo";
        setDataMode(mode);

        if (mode === "live" && Array.isArray(payload?.stories) && payload.stories.length) {
          setRemoteStories(payload.stories as Story[]);
          setSelectedId((current) =>
            payload.stories.some((story: Story) => story.id === current)
              ? current
              : payload.stories[0].id,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setDataMode("demo");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      if (hydrated) localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch { /* Reading still works when browser storage is unavailable. */ }
  }, [favorites, hydrated]);

  useEffect(() => {
    try {
      if (hydrated) localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
    } catch { /* Reading still works when browser storage is unavailable. */ }
  }, [dismissed, hydrated]);

  useEffect(() => {
    return () => {
      keepListeningRef.current = false;
      recognitionRef.current?.stop?.();
      audioRef.current?.pause();
      narrationRequestRef.current += 1;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  const homeStories = useMemo(
    () =>
      stories.filter(
        (story) =>
          anchorTime - new Date(story.publicationDate).getTime() <= TWO_DAYS_MS &&
          new Date(story.publicationDate).getTime() <= anchorTime &&
          !dismissed.includes(story.id),
      ),
    [anchorTime, dismissed, stories],
  );

  const favoriteStories = useMemo(
    () => stories.filter((story) => favorites.includes(story.id)),
    [favorites, stories],
  );

  const historyStories = useMemo(() => {
    let filtered = stories;

    if (historyRange !== "all") {
      const days = historyRange === "2d" ? 2 : historyRange === "7d" ? 7 : 30;
      const cutoff = anchorTime - days * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((story) => new Date(story.publicationDate).getTime() >= cutoff);
    }

    if (historyDate) {
      filtered = filtered.filter(
        (story) => new Date(story.publicationDate).toISOString().slice(0, 10) === historyDate,
      );
    }

    return filtered;
  }, [anchorTime, historyDate, historyRange, stories]);

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
    narrationRequestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
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
    const requestId = ++narrationRequestRef.current;
    const text = `${selected.title}. ${selected.detailedSummary}`;

    try {
      const response = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (requestId !== narrationRequestRef.current) return;

      if (!response.ok) {
        browserSpeak(text);
        return;
      }

      const blob = await response.blob();
      if (requestId !== narrationRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (requestId !== narrationRequestRef.current) return;
        setVoiceState("idle");
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        if (requestId !== narrationRequestRef.current) return;
        setVoiceState("idle");
        URL.revokeObjectURL(url);
      };
      setVoiceState("playing");
      await audio.play();
    } catch {
      if (requestId === narrationRequestRef.current) browserSpeak(text);
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
      stopNarration();
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
    if (command.includes("favorites")) return changeTab("favorites");
    if (command.includes("favorite") || command.includes("save")) return toggleFavorite(selected.id);
    if (command.includes("dismiss") || command.includes("skip")) return dismissStory(selected.id);
    if (command.includes("read") || command.includes("speak")) return void narrate();
    if (command.includes("history")) return changeTab("history");
    if (command.includes("home") || command.includes("new stories")) return changeTab("home");
    if (command.includes("stop listening")) return stopHandsFree();
    if (command.includes("stop")) return stopNarration();

    setVoiceHint("Command not recognized. Try next, previous, favorite, dismiss, read, history or home.");
  }

  useEffect(() => {
    commandHandlerRef.current = handleVoiceCommand;
  });

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
      if (transcript) commandHandlerRef.current(transcript);
    };
    recognition.onerror = (event: any) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event?.error)) {
        keepListeningRef.current = false;
        setListening(false);
      }
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
    try {
      recognition.start();
    } catch {
      keepListeningRef.current = false;
      recognitionRef.current = null;
      setVoiceHint("Voice navigation could not start. Please try again.");
      return;
    }
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
    <main className="reader-app">
      <header className="app-header">
        <button className="brand" onClick={() => changeTab("home")} aria-label="Absurdity home">
          <span className="brand-icon" aria-hidden="true">A</span>
          <h1>Absurdity</h1>
        </button>
        <nav className="tabs" aria-label="Story views">
          {([ ["home", "New stories"], ["favorites", "Favorites"], ["history", "History"] ] as const).map(([id, label]) => (
            <button key={id} onClick={() => changeTab(id)} aria-current={tab === id ? "page" : undefined}>
              {label}{id === "favorites" && favorites.length > 0 ? ` (${favorites.length})` : ""}
            </button>
          ))}
        </nav>
        <span className="data-mode" title={usingLive ? "Live story archive" : "These stories are demonstration fixtures"}>
          {usingLive ? "Live" : dataMode === "live" ? "Demo fallback" : "Demo"}
        </span>
      </header>

      <section className="view-toolbar" aria-label={`${tabTitle} filters`}>
        <span className="view-count">{visibleStories.length} {visibleStories.length === 1 ? "story" : "stories"}</span>
        {tab !== "home" && (
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stories…" aria-label="Search stories" />
        )}
        {tab === "history" && (
          <>
            <input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} aria-label="Filter history by exact publication date" />
            <select value={historyRange} onChange={(event) => setHistoryRange(event.target.value as HistoryRange)} aria-label="History timeframe">
              <option value="2d">Last 2 days</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All history</option>
            </select>
          </>
        )}
        {tab === "home" && dismissed.length > 0 && (
          <button className="text-action" onClick={restoreDismissed}>Restore dismissed ({dismissed.length})</button>
        )}
      </section>

      <section className="reading-layout" aria-label={tabTitle}>
        <aside className="story-sidebar" aria-label="Story titles">
          <div className="story-list abs-scrollbar">
            {visibleStories.length ? visibleStories.map((story) => (
              <div key={story.id} className={`story-row ${selected.id === story.id ? "is-selected" : ""}`}
                onPointerDown={(event) => onStoryPointerDown(story.id, event)} onPointerUp={(event) => onStoryPointerUp(story.id, event)}>
                <button className="story-title" onClick={() => { setSelectedId(story.id); stopNarration(); }} aria-pressed={selected.id === story.id}>
                  {story.title}
                </button>
                <div className="row-actions">
                  <button onClick={() => toggleFavorite(story.id)} aria-label={favorites.includes(story.id) ? "Remove favorite" : "Favorite story"} title={favorites.includes(story.id) ? "Remove favorite" : "Favorite"}>
                    {favorites.includes(story.id) ? "★" : "☆"}
                  </button>
                  {tab === "home" && <button onClick={() => dismissStory(story.id)} aria-label="Dismiss story" title="Dismiss">×</button>}
                </div>
              </div>
            )) : <p className="empty-state">{emptyMessage}</p>}
          </div>
          <div className="list-navigation">
            <button onClick={() => selectAdjacent(-1)} disabled={!visibleStories.length}>← Previous</button>
            <button onClick={() => selectAdjacent(1)} disabled={!visibleStories.length}>Next →</button>
          </div>
        </aside>

        <article className="story-reader" aria-label="Selected story">
          <div className="reader-body abs-scrollbar">
            {visibleStories.length > 0 ? (
              <>
                <div className="story-heading">
                  <h2>{selected.title}</h2>
                  <button className="reader-favorite" onClick={() => toggleFavorite(selected.id)} aria-label={favorites.includes(selected.id) ? "Remove selected favorite" : "Favorite selected story"} aria-pressed={favorites.includes(selected.id)} title="Favorite story">
                    {favorites.includes(selected.id) ? "★" : "☆"}
                  </button>
                </div>
                <p className="story-text">{selected.detailedSummary}</p>
                <details className="story-details" key={selected.id}>
                  <summary>Story details</summary>
                  <dl>
                    <div><dt>Place</dt><dd>{selected.country} · {selected.region}</dd></div>
                    <div><dt>Category</dt><dd>{selected.category}</dd></div>
                    <div><dt>Published</dt><dd>{formatDate(selected.publicationDate, true, hydrated)}</dd></div>
                    <div><dt>Event date</dt><dd>{formatDate(selected.eventDate, true, hydrated)}</dd></div>
                    <div><dt>Confidence</dt><dd>{selected.confidence}</dd></div>
                    <div><dt>Why it was selected</dt><dd>{selected.whyItsWeird}</dd></div>
                    <div><dt>Verification</dt><dd>{selected.verificationNotes}</dd></div>
                  </dl>
                </details>
              </>
            ) : <p className="empty-state">{emptyMessage}</p>}
          </div>
          <div className="reader-bottom">
            <div className="source-section" aria-label="Story sources">
              {visibleStories.length > 0 && <>
                <span>Sources</span>
                <div className="source-links abs-scrollbar">
                  {selected.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher} ↗</a>
                  ))}
                </div>
              </>}
            </div>
            <div className="voice-controls">
              <button onClick={narrate} disabled={!visibleStories.length} className="read-button">
                {voiceState === "loading" ? "Preparing…" : voiceState === "playing" ? "■ Stop reading" : "▶ Read aloud"}
              </button>
              <button onClick={listening ? stopHandsFree : startHandsFree} className={`talk-button ${listening ? "is-listening" : ""}`} title={voiceHint} aria-pressed={listening}>
                {listening ? "● Listening…" : "◉ Talk to Absurdity"}
              </button>
            </div>
          </div>
        </article>
      </section>
      <div className="voice-status" role="status" aria-live="polite">
        {voiceHint !== "Say “next”, “favorite”, “dismiss”, “read”, “history” or “home”." ? voiceHint : ""}
      </div>
    </main>
  );
}
