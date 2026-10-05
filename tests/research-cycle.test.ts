import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { getDatabase } from "../lib/database";
import { claimResearch, getResearchCycle, releaseResearch } from "../lib/research-cycle";
import { runDailyResearch } from "../lib/pipeline";
import { POST, GET } from "../app/api/research/route";

before(() => {
  process.env.ABSURDITY_SQLITE_PATH = ":memory:";
  for (const name of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "GROQ_API_KEY", "EXA_API_KEY", "TAVILY_API_KEY"]) delete process.env[name];
});
beforeEach(async () => {
  const db = await getDatabase();
  await db.execute("DELETE FROM research_lease");
  await db.execute("DELETE FROM research_runs");
});

test("concurrent manual claims share one run, also blocking the daily job", async () => {
  const claims = await Promise.all(Array.from({ length: 10 }, () => claimResearch()));
  assert.equal(claims.filter(claim => claim.acquired).length, 1);
  assert.equal(new Set(claims.map(claim => claim.run?.id)).size, 1);
  assert.ok(claims.every(claim => claim.run?.status === "running"));
  const daily = await runDailyResearch({ discover: async () => { throw new Error("Must not discover"); } });
  assert.ok("skipped" in daily);
});

test("a successful cycle persists completion and enforces the manual cooldown", async () => {
  const claim = await claimResearch();
  const result = await runDailyResearch({ runId: claim.run!.id,
    discover: async () => ({ scanned: 0, unusualCandidates: 0, note: "QA", candidates: [], failures: [] }) });
  assert.ok("selected" in result);
  assert.equal((await getResearchCycle(claim.run!.id))?.status, "complete");
  assert.equal((await claimResearch()).acquired, false);
  const daily = await claimResearch(false);
  assert.equal(daily.acquired, true);
  await releaseResearch(daily.run!.id);
});

test("failed discovery persists failure and releases the active lease", async () => {
  const claim = await claimResearch();
  await assert.rejects(runDailyResearch({ runId: claim.run!.id,
    discover: async () => ({ scanned: 0, unusualCandidates: 0, note: "QA", candidates: [], failures: ["RSS unavailable"] }) }), /No news feeds/);
  assert.equal((await getResearchCycle(claim.run!.id))?.status, "failed");
  assert.equal((await claimResearch(false)).acquired, true);
});

test("an interrupted run expires and an old worker cannot release its replacement", async () => {
  const claim = await claimResearch();
  const db = await getDatabase();
  await db.execute("UPDATE research_runs SET started_at = ?", [new Date(Date.now() - 31 * 60 * 1000).toISOString()]);
  await db.execute("UPDATE research_lease SET expires_at = 0, next_manual_at = 0");
  assert.equal((await getResearchCycle(claim.run!.id))?.status, "failed");
  const replacement = await claimResearch();
  await releaseResearch(claim.run!.id);
  assert.equal((await claimResearch()).run?.id, replacement.run!.id);
});

test("status is read-only and cross-site POST cannot start research", async () => {
  const response = await GET(new Request("https://app.example/api/research"));
  assert.deepEqual(await response.json(), { run: null });
  const crossSite = await POST(new Request("https://app.example/api/research", {
    method: "POST", headers: { origin: "https://other.example" },
  }));
  assert.equal(crossSite.status, 403);
  assert.equal(await getResearchCycle(), null);
});

test("duplicate POST joins an existing run without scheduling more work", async () => {
  const claim = await claimResearch();
  const response = await POST(new Request("http://app.example/api/research", {
    method: "POST", headers: { host: "app.example", origin: "https://app.example" },
  }));
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.run.id, claim.run!.id);
  assert.equal(payload.started, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
