import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { recordResearchRun } from "./repository";

const LEASE_MS = 30 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 5 * 60 * 1000;
export const RESEARCH_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export type ResearchCycle = {
  id: string;
  status: "running" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  selected: number;
  scanned: number;
  candidates: number;
  articlesExtracted: number;
  retryAt: string;
  lastActivityAt?: string;
  phase?: string;
};

// The shared lease prevents overlap with the daily job. A heartbeat lets a
// replacement process detect an interrupted worker quickly after a deploy or crash.
async function failInterruptedResearch(id: string, now: number) {
  const db = await getDatabase();
  const completedAt = new Date(now).toISOString();
  await db.batch([
    { sql: "UPDATE research_runs SET status = 'failed', completed_at = ? WHERE id = ? AND status = 'running'", params: [completedAt, id] },
    { sql: "UPDATE research_lease SET expires_at = 0, next_manual_at = 0 WHERE run_id = ?", params: [id] },
    { sql: "UPDATE research_heartbeat SET updated_at = ?, phase = 'interrupted' WHERE run_id = ?", params: [now, id] },
  ], true);
}

export async function heartbeatResearch(id: string, phase = "working") {
  const db = await getDatabase();
  const now = Date.now();
  await db.batch([
    {
      sql: `INSERT INTO research_heartbeat (run_id, updated_at, phase) VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET updated_at = excluded.updated_at, phase = excluded.phase`,
      params: [id, now, phase],
    },
    {
      sql: "UPDATE research_lease SET expires_at = ? WHERE run_id = ? AND expires_at > 0",
      params: [now + LEASE_MS, id],
    },
  ], true);
}

export async function getResearchCycle(id?: string): Promise<ResearchCycle | null> {
  const db = await getDatabase();
  const now = Date.now();
  const rows = await db.query<{
    id: string; status: ResearchCycle["status"]; started_at: string;
    completed_at: string | null; selected: number; scanned: number; candidates: number;
    provider_usage_json: string; next_manual_at: number; heartbeat_updated_at: number | null;
    heartbeat_phase: string | null;
  }>(`SELECT r.*, COALESCE(l.next_manual_at, 0) AS next_manual_at,
      h.updated_at AS heartbeat_updated_at, h.phase AS heartbeat_phase
    FROM research_runs r
    LEFT JOIN research_lease l ON l.run_id = r.id
    LEFT JOIN research_heartbeat h ON h.run_id = r.id
    ${id ? "WHERE r.id = ?" : ""} ORDER BY r.started_at DESC LIMIT 1`, id ? [id] : []);
  const row = rows[0];
  if (!row) return null;

  let activityMs = Number(row.heartbeat_updated_at) || Date.parse(row.started_at);
  let retryAtMs = Number(row.next_manual_at);
  if (row.status === "running" && (!Number.isFinite(activityMs) || now - activityMs >= RESEARCH_HEARTBEAT_STALE_MS)) {
    await failInterruptedResearch(row.id, now);
    row.status = "failed";
    row.completed_at = new Date(now).toISOString();
    row.heartbeat_phase = "interrupted";
    activityMs = now;
    retryAtMs = 0;
  }

  const usage = JSON.parse(row.provider_usage_json);
  return { id: row.id, status: row.status, startedAt: row.started_at,
    completedAt: row.completed_at, selected: Number(row.selected), scanned: Number(row.scanned),
    candidates: Number(row.candidates), articlesExtracted: Number(usage.articlesExtracted || 0),
    retryAt: new Date(retryAtMs).toISOString(),
    lastActivityAt: Number.isFinite(activityMs) ? new Date(activityMs).toISOString() : undefined,
    phase: row.heartbeat_phase || undefined };
}

export async function claimResearch(manual = true) {
  const db = await getDatabase();
  const now = Date.now();
  const id = randomUUID();
  const rows = await db.query<{ run_id: string }>(`INSERT INTO research_lease
    (singleton, run_id, expires_at, next_manual_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET run_id = excluded.run_id,
      expires_at = excluded.expires_at, next_manual_at = excluded.next_manual_at
    WHERE research_lease.expires_at <= ? AND (? = 0 OR research_lease.next_manual_at <= ?)
    RETURNING run_id`, [id, now + LEASE_MS, now + MANUAL_COOLDOWN_MS, now, manual ? 1 : 0, now]);
  if (!rows.length) {
    const lease = (await db.query<{ run_id: string; expires_at: number; next_manual_at: number }>(
      "SELECT * FROM research_lease WHERE singleton = 1"))[0];
    const run = await getResearchCycle(lease.run_id);
    return { acquired: false, run: run ?? { id: lease.run_id, status: "running" as const,
      startedAt: new Date(Number(lease.expires_at) - LEASE_MS).toISOString(),
      completedAt: null, selected: 0, scanned: 0, candidates: 0, articlesExtracted: 0, retryAt: new Date(Number(lease.next_manual_at)).toISOString() } };
  }
  try {
    await recordResearchRun({ id, startedAt: new Date(now).toISOString(),
      windowStart: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      windowEnd: new Date(now).toISOString(), status: "running", scanned: 0,
      candidates: 0, selected: 0, failures: [], providerUsage: {} });
    await heartbeatResearch(id, "queued");
    return { acquired: true, run: await getResearchCycle(id) };
  } catch (error) {
    await releaseResearch(id);
    throw error;
  }
}

export async function releaseResearch(id: string) {
  const db = await getDatabase();
  await db.execute("UPDATE research_lease SET expires_at = 0 WHERE run_id = ?", [id]);
}
