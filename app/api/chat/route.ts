import { NextResponse } from "next/server";
import { answerFromCorpus } from "@/lib/agent";
import { demoBriefing } from "@/lib/demo-data";
import { OpenAIIntelligenceProvider } from "@/lib/providers/intelligence";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const storyId = typeof body.storyId === "string" ? body.storyId : undefined;

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const provider = new OpenAIIntelligenceProvider();

    if (provider.available()) {
      try {
        const text = await provider.converse(message, demoBriefing.stories, storyId);
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

    return NextResponse.json({
      ...answerFromCorpus(message, storyId),
      provider: "deterministic",
    });
  } catch (error) {
    console.error("Conversation route failed.", error);
    return NextResponse.json({ error: "Conversation failed safely." }, { status: 500 });
  }
}
