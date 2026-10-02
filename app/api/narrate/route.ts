import { NextResponse } from "next/server";
import { ElevenLabsVoiceProvider } from "@/lib/providers/voice";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "Text is required." }, { status: 400 });
    }

    const provider = new ElevenLabsVoiceProvider();
    if (!provider.available()) {
      return NextResponse.json(
        { error: "ElevenLabs is not configured.", fallback: "browser-speech" },
        { status: 503 },
      );
    }

    const audio = await provider.synthesize(text.slice(0, 5000));
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Narration route failed.", error);
    return NextResponse.json(
      { error: "Narration failed safely.", fallback: "browser-speech" },
      { status: 502 },
    );
  }
}
