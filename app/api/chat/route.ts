import { NextResponse } from "next/server";
import { answerFromCorpus } from "@/lib/agent";
import { GroqIntelligenceProvider } from "@/lib/providers/intelligence";
import { storyRepository } from "@/lib/repository";
import { replyToVoice } from "@/lib/voice-agent";
import type { ConversationTurn } from "@/lib/conversation";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const storyId = typeof body?.storyId === "string" ? body.storyId : undefined;

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }
    if (message.length > 2000) return NextResponse.json({ error: "Message is too long." }, { status: 400 });
    if (body.voice === true) {
      const scope = ["home", "favorites", "history"].includes(body.scope) ? body.scope : "home";
      const visibleIds = Array.isArray(body.visibleIds) ? body.visibleIds.filter((id: unknown) => typeof id === "string" && id.length <= 150).slice(0, 24) : [];
      const history: ConversationTurn[] = Array.isArray(body.history)
        ? body.history.filter((turn: any) => ["user", "assistant"].includes(turn?.role) && typeof turn?.content === "string")
          .slice(-8).map((turn: ConversationTurn) => ({ role: turn.role, content: turn.content.slice(0, 2000) })) : [];
      return NextResponse.json(await replyToVoice({ message, storyId, scope, visibleIds, history, displayMode: body.displayMode === "demo" ? "demo" : "live" }));
    }

    const briefing = await storyRepository.getCurrentBriefing();
    const selectedStory = storyId ? await storyRepository.getStory(storyId) : null;
    const corpus = selectedStory && !briefing.stories.some((story) => story.id === selectedStory.id)
      ? [...briefing.stories, selectedStory]
      : briefing.stories;
    const provider = new GroqIntelligenceProvider();

    if (provider.available()) {
      try {
        const text = await provider.converse(message, corpus, storyId);
        return NextResponse.json({
          text,
          intent: "groq-grounded",
          provider: "groq",
          storyId,
        });
      } catch (error) {
        console.warn("Groq conversation failed; using deterministic corpus agent.", error);
      }
    }

    if (briefing.mode === "demo") {
      return NextResponse.json({
        ...answerFromCorpus(message, storyId),
        provider: "deterministic",
      });
    }

    return NextResponse.json({
      text:
        briefing.stories.length > 0
          ? "The live briefing is available, but the deterministic demo agent is intentionally disabled for live claims. Configure Groq for grounded conversation."
          : "No verified live stories are available in the current briefing yet.",
      provider: "safe-fallback",
      intent: "live-fallback",
      storyId,
    });
  } catch (error) {
    console.error("Conversation route failed.", error);
    return NextResponse.json({ error: "Conversation failed safely." }, { status: 500 });
  }
}
