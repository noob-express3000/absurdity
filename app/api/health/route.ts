import { NextResponse } from "next/server";
import { databaseStatus } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseStatus();

  return NextResponse.json(
    {
      status: database.ready ? "ok" : "degraded",
      service: "absurdity",
      mode: process.env.ABSURDITY_MODE || "demo",
      runtime: "node",
      render: process.env.RENDER === "true",
      database,
      providers: {
        groq: Boolean(process.env.GROQ_API_KEY),
        elevenlabs: Boolean(
          process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
        ),
        exa: Boolean(process.env.EXA_API_KEY),
        tavily: Boolean(process.env.TAVILY_API_KEY),
      },
      research: {
        windowHours: Number(process.env.RESEARCH_WINDOW_HOURS || 30),
        maxCandidates: Number(process.env.RESEARCH_MAX_CANDIDATES || 12),
      },
    },
    {
      status: database.ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
