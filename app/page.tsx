"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { demoBriefing } from "@/lib/demo-data";
import type { Story } from "@/lib/types";

type View = "briefing" | "research";
type ChatMessage = { role: "agent" | "user"; text: string };

const promptChips = [
  "Give me the weirdest one",
  "Anything from Africa?",
  "Animals only",
  "Did this actually happen?",
];

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function confidenceLabel(story: Story) {
  return story.confidence.charAt(0).toUpperCase() + story.confidence.slice(1) + " confidence";
}

export default function Home() {
  const [view, setView] = useState<View>("briefing");
  const [selectedId, setSelectedId] = useState(demoBriefing.stories[0].id);
  const [query, setQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const [livePreview, setLivePreview] = useState<any>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text:
        "I reviewed the seeded competition corpus and selected 7 stories. Demo Mode makes no live-news claims. Ask for the weirdest one, a region, a category, verification, sources, or a deep dive.",
    },
  ]);

  const selected =
    demoBriefing.stories.find((story) => story.id === selectedId) ?? demoBriefing.stories[0];

  const visibleStories = useMemo(() => {
    const needle = query.toLowerCase().trim();
    if (!needle) return demoBriefing.stories;
    return demoBriefing.stories.filter((story) =>
      [story.title, story.country, story.region, story.category, story.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  async function askAgent(message: string) {
    const clean = message.trim();
    if (!clean || busy) return;

    setMessages((current) => [...current, { role: "user", text: clean }]);
    setChatInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: clean, storyId: selected.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Agent request failed.");

      setMessages((current) => [...current, { role: "agent", text: payload.text }]);
      if (payload.storyId && demoBriefing.stories.some((story) => story.id === payload.storyId)) {
        setSelectedId(payload.storyId);
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: "agent",
          text: "The conversational layer failed safely. The researched briefing remains available.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    await askAgent(chatInput);
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
    setVoiceState("playing");
    window.speechSynthesis.speak(utterance);
  }

  async function narrate() {
    if (voiceState === "playing") {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      setVoiceState("idle");
      return;
    }

    setVoiceState("loading");
    const text = selected.title + ". " + selected.detailedSummary;

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
      setVoiceState("playing");
      await audio.play();
    } catch {
      browserSpeak(text);
    }
  }

  async function runLivePreview() {
    setLiveBusy(true);
    try {
      const response = await fetch("/api/research", { method: "POST" });
      const payload = await response.json();
      setLivePreview(payload);
    } catch {
      setLivePreview({ error: "Live discovery could not be reached. Demo Mode is unaffected." });
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-7 md:py-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5 flex flex-col gap-4 border-b border-[var(--line)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--ink)] text-sm font-black text-white">
                A
              </div>
              <span className="abs-mono text-xs text-[var(--muted)]">
                Autonomous global absurdity desk
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.045em] md:text-5xl">
              Absurdity read the news so you did not have to.
            </h1>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto">
            <span className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs font-bold">
              DEMO
            </span>
            <span className="rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-bold text-white">
              7 SELECTED
            </span>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ["1,842", "stories scanned"],
            ["43", "unusual candidates"],
            ["19", "verified"],
            ["7", "selected"],
            ["7", "countries"],
          ].map(([value, label]) => (
            <div key={label} className="abs-card rounded-2xl px-4 py-4">
              <div className="text-2xl font-black tracking-[-0.04em]">{value}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">{label}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <nav className="flex gap-1 rounded-full border border-[var(--line)] bg-[var(--paper)] p-1">
                <button
                  onClick={() => setView("briefing")}
                  className={
                    "rounded-full px-4 py-2 text-sm font-bold " +
                    (view === "briefing"
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--muted)]")
                  }
                >
                  Briefing
                </button>
                <button
                  onClick={() => setView("research")}
                  className={
                    "rounded-full px-4 py-2 text-sm font-bold " +
                    (view === "research"
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--muted)]")
                  }
                >
                  Research activity
                </button>
              </nav>

              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter stories"
                  className="w-44 rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-sm outline-none focus:border-[var(--ink)]"
                />
                <button
                  onClick={runLivePreview}
                  disabled={liveBusy}
                  className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {liveBusy ? "Scanning…" : "Live RSS preview"}
                </button>
              </div>
            </div>

            {livePreview && (
              <div className="mb-4 rounded-2xl border border-[var(--line)] bg-[#edf5f1] p-4 text-sm">
                <div className="font-bold">Live preview</div>
                {livePreview.error ? (
                  <div className="mt-1 text-[var(--muted)]">{livePreview.error}</div>
                ) : (
                  <div className="mt-1 text-[var(--muted)]">
                    Scanned {livePreview.scanned} RSS items; {livePreview.unusualCandidates} passed
                    deterministic unusual-term triage.
                    {livePreview.failures?.length
                      ? " Feed failures: " + livePreview.failures.join(", ") + "."
                      : ""}
                  </div>
                )}
              </div>
            )}

            {view === "briefing" ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.96fr)_minmax(340px,1.04fr)]">
                <div className="abs-card overflow-hidden rounded-3xl">
                  <div className="border-b border-[var(--line)] px-5 py-4">
                    <div className="abs-mono text-xs text-[var(--muted)]">Today&apos;s desk</div>
                    <h2 className="mt-1 text-xl font-black">Seven stories survived the cut.</h2>
                  </div>
                  <div className="abs-scrollbar max-h-[760px] overflow-y-auto">
                    {visibleStories.map((story) => (
                      <button
                        key={story.id}
                        onClick={() => setSelectedId(story.id)}
                        className={
                          "block w-full border-b border-[var(--line)] p-5 text-left transition last:border-b-0 " +
                          (selected.id === story.id ? "bg-[#f0ebe0]" : "hover:bg-[#f8f5ef]")
                        }
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="abs-mono text-[10px] text-[var(--accent-dark)]">
                              #{story.rank}
                            </span>
                            <span className="rounded-full bg-[var(--soft)] px-2.5 py-1 text-[11px] font-bold">
                              {story.category}
                            </span>
                          </div>
                          <span className="text-[11px] text-[var(--muted)]">{story.country}</span>
                        </div>
                        <h3 className="text-lg font-black leading-tight tracking-[-0.025em]">
                          {story.title}
                        </h3>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
                          {story.summary}
                        </p>
                        <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--muted)]">
                          <span>{confidenceLabel(story)}</span>
                          <span>•</span>
                          <span>
                            {story.sources.length} source{story.sources.length === 1 ? "" : "s"}
                          </span>
                          {story.seriousness === "serious" && (
                            <>
                              <span>•</span>
                              <span className="font-bold text-[var(--amber)]">serious tone</span>
                            </>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <article className="abs-card rounded-3xl p-6 md:p-7">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-bold text-white">
                        {selected.country}
                      </span>
                      <span className="rounded-full bg-[var(--soft)] px-3 py-1.5 text-[11px] font-bold">
                        {selected.category}
                      </span>
                    </div>
                    <button
                      onClick={narrate}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-bold"
                    >
                      {voiceState === "loading"
                        ? "Preparing audio…"
                        : voiceState === "playing"
                          ? "Stop narration"
                          : "Read this to me"}
                    </button>
                  </div>

                  <h2 className="text-3xl font-black leading-[1.03] tracking-[-0.045em] md:text-4xl">
                    {selected.title}
                  </h2>
                  <p className="mt-5 text-base leading-7 text-[var(--muted)]">
                    {selected.detailedSummary}
                  </p>

                  <div className="my-6 border-y border-[var(--line)] py-5">
                    <div className="abs-mono text-[10px] text-[var(--muted)]">
                      Why Absurdity selected it
                    </div>
                    <p className="mt-2 text-lg font-bold leading-7">{selected.whyItsWeird}</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="abs-mono text-[10px] text-[var(--muted)]">Event date</div>
                      <div className="mt-1 text-sm font-bold">{formatDate(selected.eventDate)}</div>
                    </div>
                    <div>
                      <div className="abs-mono text-[10px] text-[var(--muted)]">
                        Publication date
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {formatDate(selected.publicationDate)}
                      </div>
                    </div>
                    <div>
                      <div className="abs-mono text-[10px] text-[var(--muted)]">Verification</div>
                      <div className="mt-1 text-sm font-bold">{confidenceLabel(selected)}</div>
                    </div>
                    <div>
                      <div className="abs-mono text-[10px] text-[var(--muted)]">
                        Reporting cluster
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {selected.sources.length} attached source
                        {selected.sources.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl bg-[#f7f1e8] p-4">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-[var(--accent-dark)]">
                      Demo integrity note
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {selected.verificationNotes}
                    </p>
                  </div>

                  <div className="mt-6">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="font-black">Sources</div>
                      <button
                        onClick={() => setView("research")}
                        className="text-xs font-bold text-[var(--accent-dark)]"
                      >
                        See research trail →
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selected.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] px-4 py-3 text-sm hover:bg-[#f8f5ef]"
                        >
                          <span className="font-bold">{source.publisher}</span>
                          <span className="text-xs text-[var(--muted)]">{source.sourceType}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </article>
              </div>
            ) : (
              <div className="abs-card rounded-3xl p-6 md:p-8">
                <div className="flex flex-col gap-3 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="abs-mono text-xs text-[var(--muted)]">
                      Autonomous work, made visible
                    </div>
                    <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">
                      {selected.shortTitle}
                    </h2>
                  </div>
                  <span className="rounded-full bg-[#edf5f1] px-3 py-2 text-xs font-bold text-[var(--green)]">
                    {selected.research.length} recorded steps
                  </span>
                </div>

                <div className="mt-6 grid gap-3">
                  {selected.research.map((step, index) => (
                    <div
                      key={step.label + step.at}
                      className="grid grid-cols-[36px_minmax(0,1fr)_52px] gap-3 rounded-2xl border border-[var(--line)] p-4"
                    >
                      <div
                        className={
                          "grid h-9 w-9 place-items-center rounded-full text-xs font-black " +
                          (step.status === "warning"
                            ? "bg-[#f6ecd9] text-[var(--amber)]"
                            : "bg-[#e6f1ec] text-[var(--green)]")
                        }
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-black">{step.label}</div>
                        <div className="mt-1 text-sm leading-6 text-[var(--muted)]">
                          {step.detail}
                        </div>
                      </div>
                      <div className="pt-1 text-right text-xs text-[var(--muted)]">{step.at}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="abs-card flex min-h-[640px] flex-col rounded-3xl p-5 xl:sticky xl:top-4 xl:h-[calc(100vh-32px)]">
            <div className="border-b border-[var(--line)] pb-4">
              <div className="abs-mono text-[10px] text-[var(--muted)]">Desk conversation</div>
              <h2 className="mt-1 text-xl font-black">Ask what the desk already knows.</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Grounded in the briefing corpus first. Optional OpenAI reasoning activates only when configured.
              </p>
            </div>

            <div className="my-4 flex flex-wrap gap-2">
              {promptChips.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => askAgent(prompt)}
                  className="rounded-full border border-[var(--line)] bg-[#f8f5ef] px-3 py-2 text-xs font-bold hover:border-[var(--ink)]"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="abs-scrollbar flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.map((message, index) => (
                <div key={index} className={message.role === "agent" ? "pr-7" : "pl-7"}>
                  <div
                    className={
                      "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 " +
                      (message.role === "agent"
                        ? "bg-[#f1ece3]"
                        : "bg-[var(--ink)] text-white")
                    }
                  >
                    {message.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="pr-7">
                  <div className="rounded-2xl bg-[#f1ece3] px-4 py-3 text-sm text-[var(--muted)]">
                    Checking the researched corpus…
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={submitChat} className="mt-4 border-t border-[var(--line)] pt-4">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask about the briefing…"
                  className="min-w-0 flex-1 rounded-full border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--ink)]"
                />
                <button
                  disabled={busy || !chatInput.trim()}
                  className="rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                  Ask
                </button>
              </div>
            </form>
          </aside>
        </section>

        <footer className="mt-5 flex flex-col gap-2 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)] md:flex-row md:items-center md:justify-between">
          <span>
            Seeded Demo Mode • same story model, dashboard, agent and research trail intended for Live Mode
          </span>
          <span>RSS first • deterministic triage • AI on shortlist • voice on demand</span>
        </footer>
      </div>
    </main>
  );
}
