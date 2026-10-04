import { NextResponse } from "next/server";
import { answerFromCorpus } from "@/lib/agent";
import { OpenAIIntelligenceProvider } from "@/lib/providers/intelligence";
import { storyRepository } from "@/lib/repository";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const storyId = typeof body.storyId === "string" ? body.storyId : undefined;

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const briefing = await storyRepository.getCurrentBriefing();
    const provider = new OpenAIIntelligenceProvider();

    if (provider.available()) {
      try {
        const text = await provider.converse(message, briefing.stories, storyId);
        return NextResponse.json({
          text,
          intent: "openai-grounded",
          provider: "openai",
          storyId,
        });
      } catch (error) {
        console.warn("OpenAI conversation failed; using deterministic corpus agent.", error);
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
          ? "The live briefing is available, but the deterministic demo agent is intentionally disabled for live claims. Configure OpenAI for grounded conversation."
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
