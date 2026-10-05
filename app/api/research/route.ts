import { after, NextResponse } from "next/server";
import { runDailyResearch } from "@/lib/pipeline";
import { claimResearch, getResearchCycle } from "@/lib/research-cycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || undefined;
    return NextResponse.json({ run: await getResearchCycle(id) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check the fetch cycle." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host)) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Use the app to fetch stories." }, { status: 403 });
  }
  try {
    const claim = await claimResearch();
    if (claim.acquired && claim.run) {
      const runId = claim.run.id;
      after(async () => {
        try { await runDailyResearch({ runId }); }
        catch (error) { console.error("Manual research failed.", error); }
      });
    }
    return NextResponse.json({ run: claim.run, started: claim.acquired }, {
      status: claim.run?.status === "running" ? 202 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Could not start a fetch cycle. Try again shortly." }, { status: 503 });
  }
}
