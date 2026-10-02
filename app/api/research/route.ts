import { NextResponse } from "next/server";
import { runLightweightDiscovery } from "@/lib/research";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await runLightweightDiscovery();
    return NextResponse.json({
      mode: "live-preview",
      generatedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Research discovery failed.", error);
    return NextResponse.json(
      { error: "Live discovery failed safely. Demo Mode remains available." },
      { status: 502 },
    );
  }
}
