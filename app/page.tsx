"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { demoBriefing } from "@/lib/demo-data";
import type { Story } from "@/lib/types";
import { parseNavigation } from "@/lib/navigation";
import type { ConversationTurn } from "@/lib/conversation";
import type { ResearchCycle } from "@/lib/research-cycle";
import type { VoiceReply } from "@/lib/voice-agent";

type Tab = "home" | "favorites" | "history";
type VoiceState = "idle" | "loading" | "playing";

const FAVORITES_KEY = "absurdity:favorites:v1";
const DISMISSED_KEY = "absurdity:dismissed:v1";
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const ARCHIVE_REFRESH_MS = 5 * 60 * 1000;

function cycleSummary(run: ResearchCycle) {
  return `Reviewed ${run.candidates} candidates; selected ${run.selected} ${run.selected === 1 ? "story" : "stories"}.`;
}

function parseStoredIds(key: string) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const storyDateFormatter = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Johannesburg",
});

function formatStoryDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? storyDateFormatter.format(date) : "Date unavailable";
}

function demoClock() {
  if (demoBriefing.mode !== "demo") return Date.now();
  return Math.max(...demoBriefing.stories.map((story) => new Date(story.publicationDate).getTime()));
}

export default function Home() {
  const [remoteStories, setRemoteStories] = useState<Story[] | null>(null);
  const [dataMode, setDataMode] = useState<"loading" | "demo" | "live">("loading");
  const [archiveError, setArchiveError] = useState("");
  const stories = dataMode === "demo" ? demoBriefing.stories : remoteStories ?? [];
  const usingLive = dataMode !== "demo";
  const [tab, setTab] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState(demoBriefing.stories[0].id);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Story[] | null>(null);
  const [showAgentPrompt, setShowAgentPrompt] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [fetching, setFetching] = useState(false);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [fetchHint, setFetchHint] = useState("");
  const [narrationHint, setNarrationHint] = useState("");
  const fetchBusyRef = useRef(false);
  const fetchReplyRef = useRef(false);
  const archiveRequestRef = useRef(0);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const anchorTime = useMemo(() => (usingLive ? Date.now() : demoClock()), [usingLive, remoteStories]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const commandHandlerRef = useRef<(command: string) => void>(() => {});
  const narrationRequestRef = useRef(0);
  const agentRequestRef = useRef(0);
  const agentControllerRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<ConversationTurn[]>([]);
  const speechActiveRef = useRef(false);
  const recognitionStateRef = useRef<"idle" | "running" | "stopping">("idle");
  const audioUrlRef = useRef<string | null>(null);
  const gestureRef = useRef<{ id: string; x: number } | null>(null);

  useEffect(() => {
    setFavorites(parseStoredIds(FAVORITES_KEY));
    setDismissed(parseStoredIds(DISMISSED_KEY));
    setHydrated(true);
  }, []);

  const reloadArchive = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++archiveRequestRef.current;
    try {
      const response = await fetch("/api/stories?scope=history&limit=500", {
        cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Could not refresh stories.");
      const payload = await response.json();
      if (signal?.aborted || requestId !== archiveRequestRef.current) return;
      if (!["live", "demo"].includes(payload?.mode) || !Array.isArray(payload?.stories)) {
        throw new Error("Invalid archive response.");
      }
      setArchiveError("");
      const mode = payload.mode;
      if (mode === "live") {
        setDataMode("live");
        if (payload.stories.length) {
          setRemoteStories(payload.stories as Story[]);
          setSelectedId(current =>
            payload.stories.some((story: Story) => story.id === current) ? current : payload.stories[0].id);
        } else {
          // An empty persistent archive is genuinely empty. Never replace it with
          // seeded fixtures in live mode.
          setRemoteStories([]);
        }
      } else if (mode === "demo") {
        setDataMode("demo");
        setRemoteStories(null);
        setSelectedId(current =>
          demoBriefing.stories.some(story => story.id === current) ? current : demoBriefing.stories[0].id);
      }
    } catch (error) {
      if (signal?.aborted || requestId !== archiveRequestRef.current) return;
      setArchiveError("Couldn't load the story archive. Try again.");
      throw error;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadArchive(controller.signal).catch(() => {});
    // Resume an existing cycle after a reload; reading status never starts research.
    void fetch("/api/research", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!controller.signal.aborted && payload?.run?.status === "running") {
          fetchBusyRef.current = true;
          setFetching(true);
          setCycleId(payload.run.id);
        }
      }).catch(() => {});
    return () => { controller.abort(); fetchControllerRef.current?.abort(); };
  }, [reloadArchive]);

  useEffect(() => {
    function refreshVisibleArchive() {
      if (document.visibilityState === "visible" && !fetchBusyRef.current) {
        void reloadArchive().catch(() => {});
      }
    }

    const timer = window.setInterval(refreshVisibleArchive, ARCHIVE_REFRESH_MS);
    window.addEventListener("focus", refreshVisibleArchive);
    document.addEventListener("visibilitychange", refreshVisibleArchive);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleArchive);
      document.removeEventListener("visibilitychange", refreshVisibleArchive);
    };
  }, [reloadArchive]);

  useEffect(() => {
    if (!cycleId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function check() {
      try {
        const response = await fetch(`/api/research?id=${encodeURIComponent(cycleId!)}`,
          { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not check the fetch cycle.");
        const { run }: { run: ResearchCycle | null } = await response.json();
        if (controller.signal.aborted) return;
        if (!run) throw new Error("Fetch cycle unavailable.");
        if (run.status === "running") { failures = 0; timer = setTimeout(check, 2500); return; }
        if (run.status === "failed") { failures = 3; throw new Error("Fetch interrupted. Try again shortly."); }
        await reloadArchive(controller.signal);
        if (!controller.signal.aborted) {
          const text = cycleSummary(run);
          if (fetchReplyRef.current) { setFetchHint(""); setAgentReply(text); }
          else setFetchHint(text);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (++failures < 3) { timer = setTimeout(check, 4000); return; }
        const text = error instanceof Error ? error.message : "Fetch failed. Try again shortly.";
        if (fetchReplyRef.current) { setFetchHint(""); setAgentReply(text); }
        else setFetchHint(text);
      }
      if (!controller.signal.aborted) {
        fetchBusyRef.current = false;
        fetchReplyRef.current = false;
        setFetching(false);
        setCycleId(null);
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cycleId, reloadArchive]);

  useEffect(() => {
    if (!fetchHint) return;
    const timer = setTimeout(() => setFetchHint(""), 8000);
    return () => clearTimeout(timer);
  }, [fetchHint]);

  useEffect(() => {
    if (!narrationHint) return;
    const timer = setTimeout(() => setNarrationHint(""), 12000);
    return () => clearTimeout(timer);
  }, [narrationHint]);

  function reportFetch(text: string, spoken: boolean) {
    if (spoken) { setFetchHint(""); setAgentReply(text); void speakText(text); }
    else setFetchHint(text);
  }

  async function fetchStories(spoken = false) {
    if (fetchBusyRef.current) {
      if (spoken) fetchReplyRef.current = true;
      reportFetch("Already fetching stories.", spoken); return;
    }
    fetchReplyRef.current = spoken;
    stopNarration();
    // Recover from an empty search without clearing a story that is being read.
    if (!visibleStories.length) {
      setSearchResults(null);
      if (!baseStories.length && stories.length) setTab("history");
    }
    fetchBusyRef.current = true;
    setFetching(true);
    setFetchHint("");
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    try {
      const response = await fetch("/api/research", { method: "POST", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.run) throw new Error(payload.error || "Could not start a fetch cycle.");
      if (payload.run.status === "running") {
        setCycleId(payload.run.id);
        reportFetch(payload.started ? "Fetching stories." : "Already fetching stories.", spoken);
        return;
      }
      await reloadArchive(controller.signal);
      reportFetch(payload.run.status === "failed" ? "Fetch interrupted. Try again shortly."
        : "The last fetch is still recent. A new fetch is available in a few minutes.", spoken);
    } catch (error) {
      if (!controller.signal.aborted) reportFetch(error instanceof Error ? error.message : "Fetch failed.", spoken);
    }
    if (!controller.signal.aborted) { fetchBusyRef.current = false; setFetching(false); }
  }

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
      agentRequestRef.current += 1;
      agentControllerRef.current?.abort();
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

  const baseStories = tab === "home" ? homeStories : tab === "favorites" ? favoriteStories : stories;
  const visibleStories = searchResults
    ? tab === "favorites" ? searchResults.filter((story) => favorites.includes(story.id)) : searchResults
    : baseStories;

  const selected = visibleStories.find((story) => story.id === selectedId) ?? visibleStories[0] ?? stories[0] ?? demoBriefing.stories[0];

  useEffect(() => {
    if (visibleStories.length && !visibleStories.some((story) => story.id === selectedId)) {
      setSelectedId(visibleStories[0].id);
    }
  }, [selectedId, visibleStories]);

  function resumeListening() {
    if (!keepListeningRef.current || speechActiveRef.current || recognitionStateRef.current !== "idle") return;
    try {
      recognitionRef.current?.start();
      recognitionStateRef.current = "running";
    } catch {
      keepListeningRef.current = false;
      setListening(false);
      setShowAgentPrompt(true);
      setVoiceHint("Voice navigation could not restart. Type an instruction instead.");
    }
  }

  function finishSpeech(requestId: number) {
    if (requestId !== narrationRequestRef.current) return;
    speechActiveRef.current = false;
    setVoiceState("idle");
    resumeListening();
  }

  function stopNarration() {
    narrationRequestRef.current += 1;
    agentRequestRef.current += 1;
    agentControllerRef.current?.abort();
    agentControllerRef.current = null;
    setAgentBusy(false);
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    window.speechSynthesis?.cancel();
    speechActiveRef.current = false;
    setVoiceState("idle");
    resumeListening();
  }

  function browserSpeak(text: string, requestId: number) {
    if (!("speechSynthesis" in window)) {
      finishSpeech(requestId);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = () => finishSpeech(requestId);
    utterance.onerror = () => finishSpeech(requestId);
    setVoiceState("playing");
    window.speechSynthesis.speak(utterance);
  }

  async function speakText(text: string) {
    stopNarration();
    const requestId = ++narrationRequestRef.current;
    speechActiveRef.current = true;
    if (recognitionStateRef.current === "running") {
      recognitionStateRef.current = "stopping";
      recognitionRef.current?.stop();
    }
    setVoiceState("loading");
    setNarrationHint("");
    try {
      const response = await fetch("/api/narrate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (requestId !== narrationRequestRef.current) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (requestId !== narrationRequestRef.current) return;
        setNarrationHint(`${failure?.error || "ElevenLabs narration is unavailable."} Using device voice.`);
        return browserSpeak(text, requestId);
      }
      const blob = await response.blob();
      if (requestId !== narrationRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      const release = () => {
        URL.revokeObjectURL(url);
        if (audioUrlRef.current === url) audioUrlRef.current = null;
      };
      audio.onended = () => { release(); finishSpeech(requestId); };
      audio.onerror = () => {
        release();
        if (requestId === narrationRequestRef.current) {
          setNarrationHint("Could not play ElevenLabs audio. Using device voice.");
          browserSpeak(text, requestId);
        }
      };
      setVoiceState("playing");
      await audio.play();
    } catch {
      if (requestId !== narrationRequestRef.current) return;
      setNarrationHint("Narration connection or audio playback failed. Using device voice.");
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
      if (requestId === narrationRequestRef.current) browserSpeak(text, requestId);
    }
  }

  function narrate() {
    if (voiceState !== "idle" || agentBusy) return stopNarration();
    if (visibleStories.length) void speakText(`${selected.title}. ${selected.detailedSummary}`);
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
    recognitionStateRef.current = "idle";
    setListening(false);
  }

  async function askAgent(message: string) {
    stopNarration();
    const requestId = ++agentRequestRef.current;
    const controller = new AbortController();
    agentControllerRef.current = controller;
    setAgentBusy(true);
    setAgentReply("");
    setVoiceHint("Thinking…");
    try {
      const response = await fetch("/api/chat", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: true, message, storyId: visibleStories.length ? selected.id : undefined,
          scope: tab, visibleIds: visibleStories.slice(0, 24).map(story => story.id),
          history: conversationRef.current, displayMode: usingLive ? "live" : "demo" }),
      });
      if (!response.ok) throw new Error("Conversation unavailable");
      const reply: VoiceReply = await response.json();
      if (requestId !== agentRequestRef.current) return;
      agentControllerRef.current = null;
      const plan = reply.action;
      let text = reply.text;
      let target = plan.storyId ? stories.find(story => story.id === plan.storyId) : visibleStories.length ? selected : undefined;
      switch (plan.action) {
        case "refresh": void fetchStories(true); return;
        case "view":
          if (plan.view) {
            changeTab(plan.view);
            target = (plan.view === "home" ? homeStories : plan.view === "favorites" ? favoriteStories : stories)[0];
            if (target) setSelectedId(target.id);
          }
          break;
        case "next": case "previous": {
          const index = Math.max(0, visibleStories.findIndex(story => story.id === selected.id));
          target = visibleStories[(index + (plan.action === "next" ? 1 : -1) + visibleStories.length) % visibleStories.length];
          selectAdjacent(plan.action === "next" ? 1 : -1);
          break;
        }
        case "select": case "read":
          if (target) {
            if (!visibleStories.some(story => story.id === target!.id)) changeTab("history");
            setSelectedId(target.id);
            stopNarration();
          }
          break;
        case "favorite": case "unfavorite":
          if (target) setFavorites(current => plan.action === "favorite"
            ? current.includes(target!.id) ? current : [...current, target!.id]
            : current.filter(id => id !== target!.id));
          break;
        case "dismiss": if (target) dismissStory(target.id); break;
        case "search": {
          const matches = (reply.stories ?? []).filter(story => plan.view !== "favorites" || favorites.includes(story.id));
          if (reply.mode === "live") setRemoteStories(current => Array.from(new Map([...(current ?? []), ...matches].map(story => [story.id, story])).values()));
          setTab(plan.view === "favorites" ? "favorites" : "history");
          setSearchResults(matches);
          target = matches[0];
          if (target) setSelectedId(target.id);
          if (plan.view === "favorites") text = matches.length
            ? `I found ${matches.length}${matches.length === 500 ? " or more" : ""} matching ${reply.mode === "demo" ? "demo " : ""}${matches.length === 1 ? "favorite" : "favorites"}. ${target.title}.`
            : "No favorites match that request.";
          break;
        }
      }
      conversationRef.current = [...conversationRef.current, { role: "user", content: message }, { role: "assistant", content: text }].slice(-8) as ConversationTurn[];
      setAgentBusy(false);
      setAgentReply(text);
      setVoiceHint(text);
      void speakText((plan.read || plan.action === "read") && target ? `${text} ${target.title}. ${target.detailedSummary}` : text);
    } catch {
      if (requestId !== agentRequestRef.current) return;
      agentControllerRef.current = null;
      setAgentBusy(false);
      const text = "I couldn't connect just now. Try again, or use next, read, favorites, or history.";
      setAgentReply(text);
      setVoiceHint(text);
      void speakText(text);
    }
  }

  function handleVoiceCommand(raw: string) {
    const instruction = parseNavigation(raw, tab, usingLive ? Date.now() : anchorTime);
    setVoiceHint(`Heard: “${raw}”`);
    switch (instruction.action) {
      case "refresh": void fetchStories(true); return;
      case "view": return changeTab(instruction.view);
      case "next": return selectAdjacent(1);
      case "previous": return selectAdjacent(-1);
      case "favorite": if (visibleStories.length) setFavorites(current => current.includes(selected.id) ? current : [...current, selected.id]); return;
      case "dismiss": if (visibleStories.length) dismissStory(selected.id); return;
      case "read": if (visibleStories.length) void narrate(); return;
      case "stop-listening": return stopHandsFree();
      case "stop": return stopNarration();
      default: if (raw.trim()) void askAgent(raw.trim());
    }
  }

  useEffect(() => {
    commandHandlerRef.current = handleVoiceCommand;
  });

  function startHandsFree() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceHint("Voice navigation is unavailable here. Type an instruction instead.");
      setShowAgentPrompt(true);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      if (speechActiveRef.current) return;
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript?.trim();
      if (transcript) commandHandlerRef.current(transcript);
    };
    recognition.onerror = (event: any) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event?.error)) {
        keepListeningRef.current = false;
        setListening(false);
        setShowAgentPrompt(true);
      }
      if (event?.error !== "no-speech") {
        setVoiceHint(`Voice navigation error: ${event?.error ?? "unknown error"}.`);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionStateRef.current = "idle";
      if (!keepListeningRef.current) { setListening(false); return; }
      resumeListening();
    };

    keepListeningRef.current = true;
    recognitionRef.current = recognition;
    try {
      if (!speechActiveRef.current) { recognition.start(); recognitionStateRef.current = "running"; }
    } catch {
      keepListeningRef.current = false;
      recognitionRef.current = null;
      setVoiceHint("Voice navigation could not start. Please try again.");
      setShowAgentPrompt(true);
      return;
    }
    setListening(true);
    setVoiceHint("Hands-free navigation is listening.");
  }

  function changeTab(nextTab: Tab) {
    setTab(nextTab);
    setSearchResults(null);
    stopNarration();
  }

  const tabTitle =
    tab === "home" ? "New stories" : tab === "favorites" ? "Favorites" : "History";

  const emptyMessage =
    archiveError ? "The story archive is temporarily unavailable."
    : dataMode === "loading" ? "Loading stories…"
    : tab === "home"
      ? dismissed.length
        ? "You cleared the current feed. Restore dismissed stories to review it again."
        : "No stories landed in the current two-day window."
      : tab === "favorites"
        ? "No favorites yet. Save a story with the star."
        : "No archived stories match this search and timeframe.";

  return (
    <main className="reader-app">
      <header className="app-header">
        <div className="brand">
          <button className="brand-icon" onClick={() => changeTab("home")} aria-label="Home" title="Home">
            <span aria-hidden="true">?</span>
          </button>
          <button className="brand-home" onClick={() => changeTab("home")} aria-label="New stories" aria-current={tab === "home" ? "page" : undefined}>
            <h1 className="brand-name">Absurdity</h1>
          </button>
        </div>
        <nav className="tabs" aria-label="Story views">
          <button onClick={() => changeTab("home")} aria-current={tab === "home" ? "page" : undefined}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z"/></svg>
            Home
          </button>
          <button onClick={() => changeTab("favorites")} aria-current={tab === "favorites" ? "page" : undefined}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/></svg>
            Favorites
          </button>
          <button onClick={() => changeTab("history")} aria-current={tab === "history" ? "page" : undefined}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>
            History
          </button>
          <button onClick={() => void fetchStories()} aria-label="Refresh stories" aria-busy={fetching} disabled={fetching} title={fetching ? "Refreshing stories…" : "Refresh stories"}>
            {fetching ? <svg className="loading-ring" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8" strokeDasharray="34 16"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6v5h-5"/><path d="M19 11a8 8 0 1 0 1 5"/></svg>}
            <span className="refresh-label">{fetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </nav>
        <span className="data-mode" title={usingLive ? "Live story archive" : "These stories are demonstration fixtures"}>
          {usingLive ? "" : "Demo"}
        </span>
      </header>

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
                    <svg width="15" height="15" viewBox="0 0 24 24" fill={favorites.includes(story.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/></svg>
                  </button>
                  {tab === "home" && <button onClick={() => dismissStory(story.id)} aria-label="Dismiss story" title="Dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>}
                </div>
              </div>
            )) : <p className="empty-state">{emptyMessage}</p>}
          </div>
          <div className="list-navigation">
            {tab === "home" && dismissed.length > 0 && <button className="restore-action" onClick={restoreDismissed} aria-label={`Restore dismissed (${dismissed.length})`}>Restore</button>}
            <button onClick={() => selectAdjacent(-1)} disabled={!visibleStories.length} aria-label="Previous story" title="Previous"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button>
            <button onClick={() => selectAdjacent(1)} disabled={!visibleStories.length} aria-label="Next story" title="Next"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button>
          </div>
        </aside>

        <article className="story-reader" aria-label="Selected story">
          <div className="reader-body abs-scrollbar">
            {visibleStories.length > 0 ? (
              <>
                <div className="story-heading">
                  <h2>{selected.title}</h2>
                </div>
                {selected.detailedSummary
                  .split(/\n{2,}/)
                  .map((paragraph) => paragraph.trim())
                  .filter(Boolean)
                  .map((paragraph, index) => (
                    <p className="story-text" key={`${selected.id}-paragraph-${index}`}>{paragraph}</p>
                  ))}
                <div className="source-section" aria-label="Story sources">
                  <span>Sources</span>
                  <div className="source-links">
                    {selected.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.publisher} ↗</a>
                    ))}
                  </div>
                </div>
                <footer className="story-meta-footer" aria-label="Story date and verification">
                  <span>{formatStoryDate(selected.publicationDate)}</span>
                  <span title={selected.verificationNotes}>
                    {selected.confidence === "high" ? "High-confidence verification"
                      : selected.confidence === "medium" ? "Medium-confidence verification"
                      : "Limited verification"}
                  </span>
                </footer>
              </>
            ) : <p className="empty-state">{emptyMessage}</p>}
          </div>
          <div className="reader-bottom">
            {archiveError && <div className="agent-reply" role="alert"><p>{archiveError}</p><button onClick={() => void reloadArchive().catch(() => {})} aria-label="Retry loading stories">Retry</button></div>}
            {showAgentPrompt && <form className="agent-prompt" onSubmit={(event) => { event.preventDefault(); handleVoiceCommand(agentPrompt); setAgentPrompt(""); }}>
              {agentReply && <p>{agentReply}</p>}
              <div><input aria-label="Ask Absurdity to navigate" maxLength={2000} value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} /><button type="submit" aria-label="Send instruction">→</button><button type="button" onClick={() => setShowAgentPrompt(false)} aria-label="Close instruction box">×</button></div>
            </form>}

            {agentReply && !showAgentPrompt && <div className="agent-reply"><p>{agentReply}</p><button onClick={() => setAgentReply("")} aria-label="Dismiss reply">×</button></div>}
            <div className="voice-controls">
              <button onClick={() => setShowAgentPrompt(current => !current)} className="type-button" aria-label="Type to Absurdity" aria-expanded={showAgentPrompt} title="Type to Absurdity"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg></button>
              {(agentBusy || listening || voiceState !== "idle") && <span className={`voice-indicator ${listening && voiceState === "idle" && !agentBusy ? "is-listening" : ""}`} role="status"><span className="voice-wave" aria-hidden="true"><i/><i/><i/></span>{agentBusy ? "Thinking" : voiceState === "loading" ? "Preparing" : voiceState === "playing" ? "Speaking" : "Listening"}</span>}
              <button onClick={narrate} disabled={!visibleStories.length && !agentBusy && voiceState === "idle"} className="read-button" aria-label={agentBusy ? "Stop response" : voiceState === "loading" ? "Preparing…" : voiceState === "playing" ? "Stop reading" : "Read aloud"} title="Read aloud">
                {agentBusy ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> : voiceState === "loading" ? <svg className="loading-ring" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8" strokeDasharray="34 16"/></svg> : voiceState === "playing" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> : <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.8c0-.7.8-1.1 1.4-.7l10 6.2a.8.8 0 0 1 0 1.4l-10 6.2c-.6.4-1.4 0-1.4-.7V5.8Z"/></svg>}
              </button>
              <button onClick={listening ? stopHandsFree : startHandsFree} className={`talk-button ${listening ? "is-listening" : ""}`} title={listening ? "Stop listening" : "Talk to Absurdity"} aria-label={listening ? "Stop listening" : "Talk to Absurdity"} aria-pressed={listening}>
                {listening ? "●" : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M8 21h8"/></svg>}
              </button>
            </div>
          </div>
        </article>
      </section>
      {(fetchHint || narrationHint) && <div className="fetch-notice" role="status">{fetchHint || narrationHint}</div>}
      <div className="voice-status" role="status" aria-live="polite">
        {fetching ? "Fetching stories." : voiceHint}
      </div>
    </main>
  );
}
