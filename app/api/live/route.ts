import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Render liveness must never depend on an external provider. Startup already runs
// db:check, while /api/health remains the detailed database/provider diagnostic.
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "absurdity", runtime: "node" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
