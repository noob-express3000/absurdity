import { NextResponse } from "next/server";
import { storyRepository, pageSavedStories, getSavedStoriesByIds } from "@/lib/repository";
import { decodeArchiveCursor } from "@/lib/archive-pagination";
import { demoBriefing } from "@/lib/demo-data";
import { clampHistoryBefore, clampHomeFrom } from "@/lib/story-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "history";
    if (!["home", "history", "all"].includes(scope)) {
      return NextResponse.json({ error: "Scope must be home, history, or all." }, { status: 400 });
    }
    const idsParam = url.searchParams.get("ids");
    if (idsParam !== null) {
      const ids = [...new Set(idsParam.split(",").filter(Boolean))];
      if (ids.length > 30 || ids.some(id => id.length > 150 || !/^[a-zA-Z0-9_-]+$/.test(id))) {
        return NextResponse.json({ error: "Invalid story IDs." }, { status: 400 });
      }
      return NextResponse.json({
        mode: process.env.ABSURDITY_MODE === "demo" ? "demo" : "live",
        stories: await getSavedStoriesByIds(ids),
      });
    }

    const query = url.searchParams.get("q") || "";
    const paged = url.searchParams.get("paged") === "1";
    const limit = Number(url.searchParams.get("limit") || (paged ? 80 : 200));
    if (!Number.isInteger(limit) || limit < 1 || limit > (paged ? 200 : 500)) {
      return NextResponse.json({ error: paged ? "Page size must be 1 to 200." : "Limit must be an integer from 1 to 500." }, { status: 400 });
    }
    const from = url.searchParams.get("from") || undefined;
    const before = url.searchParams.get("before") || undefined;
    if ([from, before].some((date) => date && !Number.isFinite(Date.parse(date)))) {
      return NextResponse.json({ error: "Archive dates must be valid timestamps." }, { status: 400 });
    }

    if (paged) {
      let cursor;
      try { cursor = decodeArchiveCursor(url.searchParams.get("cursor")); }
      catch { return NextResponse.json({ error: "Invalid archive cursor." }, { status: 400 }); }

      const demoAnchor = process.env.ABSURDITY_MODE === "demo"
        ? Math.max(...demoBriefing.stories.map(story => Date.parse(story.publicationDate)))
        : Date.now();
      const dates = {
        from: scope === "home" ? clampHomeFrom(from, demoAnchor) : from ? new Date(from).toISOString() : undefined,
        before: scope === "history" ? clampHistoryBefore(before, demoAnchor)
          : scope === "home" ? new Date(demoAnchor + 1).toISOString()
          : before ? new Date(before).toISOString() : undefined,
      };
      const page = await pageSavedStories(query, limit, dates, cursor);
      return NextResponse.json({
        mode: process.env.ABSURDITY_MODE === "demo" ? "demo" : "live",
        ...page,
      });
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

    const mode = process.env.ABSURDITY_MODE === "demo" ? "demo" : "live";
    const anchor = mode === "demo"
      ? Math.max(...demoBriefing.stories.map((story) => Date.parse(story.publicationDate)))
      : Date.now();
    const stories = await storyRepository.searchStories(query, limit, {
      from: from ? new Date(from).toISOString() : undefined,
      before: scope === "history"
        ? clampHistoryBefore(before ? new Date(before).toISOString() : undefined, anchor)
        : before ? new Date(before).toISOString() : undefined,
    });
    return NextResponse.json({
      mode,
      stories,
    });
  } catch (error) {
    console.error("Story API failed.", error);
    return NextResponse.json(
      {
        error: "Story archive is temporarily unavailable.",
        mode: process.env.ABSURDITY_MODE === "demo" ? "demo" : "live",
      },
      { status: 503 },
    );
  }
}
