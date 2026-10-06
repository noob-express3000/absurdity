import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { recordResearchRun } from "./repository";

const LEASE_MS = 30 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 5 * 60 * 1000;

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
};

// The shared lease prevents overlap with the daily job. Interrupted work
// becomes retryable after expiry; this is not a durable background queue.
export async function getResearchCycle(id?: string): Promise<ResearchCycle | null> {
  const db = await getDatabase();
  const now = Date.now();
  await db.execute(`UPDATE research_runs SET status = 'failed', completed_at = ?
    WHERE status = 'running' AND started_at <= ?`,
  [new Date(now).toISOString(), new Date(now - LEASE_MS).toISOString()]);
  const rows = await db.query<{
    id: string; status: ResearchCycle["status"]; started_at: string;
    completed_at: string | null; selected: number; scanned: number; candidates: number; provider_usage_json: string; next_manual_at: number;
  }>(`SELECT r.*, COALESCE(l.next_manual_at, 0) AS next_manual_at
    FROM research_runs r LEFT JOIN research_lease l ON l.run_id = r.id
    ${id ? "WHERE r.id = ?" : ""} ORDER BY r.started_at DESC LIMIT 1`, id ? [id] : []);
  const row = rows[0];
  const usage = row ? JSON.parse(row.provider_usage_json) : {};
  return row ? { id: row.id, status: row.status, startedAt: row.started_at,
    completedAt: row.completed_at, selected: Number(row.selected), scanned: Number(row.scanned),
    candidates: Number(row.candidates), articlesExtracted: Number(usage.articlesExtracted || 0),
    retryAt: new Date(Number(row.next_manual_at)).toISOString() } : null;
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
      windowStart: new Date(now - 30 * 60 * 60 * 1000).toISOString(),
      windowEnd: new Date(now).toISOString(), status: "running", scanned: 0,
      candidates: 0, selected: 0, failures: [], providerUsage: {} });
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
