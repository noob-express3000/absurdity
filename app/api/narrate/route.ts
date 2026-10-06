import { NextResponse } from "next/server";
import { ElevenLabsVoiceProvider, NarrationError } from "@/lib/providers/voice";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "Text is required." }, { status: 400 });
    }

    const provider = new ElevenLabsVoiceProvider();
    if (!provider.available()) {
      return NextResponse.json(
        { error: !process.env.ELEVENLABS_API_KEY?.trim()
          ? "Set ELEVENLABS_API_KEY in Render and redeploy."
          : "Set ELEVENLABS_VOICE_ID in Render and redeploy; the API key alone is not enough.",
          code: "not_configured", fallback: "browser-speech" },
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
    const known = error instanceof NarrationError;
    const timeout = error instanceof Error && error.name === "TimeoutError";
    console.error("Narration route failed.", { code: known ? error.code : timeout ? "timeout" : "connection_error",
      providerStatus: known ? error.providerStatus : undefined });
    return NextResponse.json(
      { error: known ? error.message : timeout ? "ElevenLabs took too long to respond. Try again."
        : "Could not connect to ElevenLabs. Try again shortly.",
        code: known ? error.code : timeout ? "timeout" : "connection_error", fallback: "browser-speech" },
      { status: 502 },
    );
  }
}
