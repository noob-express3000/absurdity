import { NextResponse } from "next/server";
import { storyRepository } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "history";
    const query = url.searchParams.get("q") || "";
    const limit = Number(url.searchParams.get("limit") || 200);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json({ error: "Limit must be an integer from 1 to 500." }, { status: 400 });
    }

    if (scope === "home") {
      const briefing = await storyRepository.getCurrentBriefing();
      return NextResponse.json({
        mode: briefing.mode,
        generatedAt: briefing.generatedAt,
        window: briefing.window,
        stats: briefing.stats,
        stories: briefing.stories,
      });
    }

    const stories = await storyRepository.searchStories(query, limit);
    return NextResponse.json({
      mode: process.env.ABSURDITY_MODE === "live" ? "live" : "demo",
      stories,
    });
  } catch (error) {
    console.error("Story API failed.", error);
    return NextResponse.json(
      {
        error: "Story archive is temporarily unavailable.",
        mode: process.env.ABSURDITY_MODE === "live" ? "live" : "demo",
      },
      { status: 503 },
    );
  }
}
