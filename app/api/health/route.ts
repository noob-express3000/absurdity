import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "absurdity",
      mode: process.env.ABSURDITY_MODE || "demo",
      runtime: "node",
      render: process.env.RENDER === "true",
      providers: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        elevenlabs: Boolean(
          process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
        ),
        exa: Boolean(process.env.EXA_API_KEY),
        tavily: Boolean(process.env.TAVILY_API_KEY),
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
