import assert from "node:assert/strict";
import { test } from "node:test";
import { archivePositionIsAfter, decodeArchiveCursor, encodeArchiveCursor, type ArchivePosition } from "../lib/archive-pagination";

test("archive cursors preserve chronological order beyond 500 records", () => {
  const published = "2026-10-15T12:00:00.000Z";
  const rows: ArchivePosition[] = Array.from({ length: 623 }, (_, index) => ({
    publicationDate: index < 310 ? published : "2026-10-14T12:00:00.000Z",
    rank: index % 5,
    id: `story-${String(index).padStart(4, "0")}`,
  }));
  rows.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || a.rank - b.rank || a.id.localeCompare(b.id));
  const loaded: ArchivePosition[] = [];
  let cursor: ArchivePosition | null = null;
  while (true) {
    const remaining = rows.filter(row => !cursor || archivePositionIsAfter(row, cursor));
    const page = remaining.slice(0, 80);
    loaded.push(...page);
    if (remaining.length <= 80) break;
    cursor = decodeArchiveCursor(encodeArchiveCursor(page[page.length - 1]));
  }
  assert.equal(loaded.length, 623);
  assert.deepEqual(loaded, rows);
  assert.equal(new Set(loaded.map(row => row.id)).size, 623);
});

test("archive cursor cannot be malformed or excessively long", () => {
  assert.equal(decodeArchiveCursor(null), null);
  assert.throws(() => decodeArchiveCursor("not-json"), /Invalid archive cursor/);
  assert.throws(() => decodeArchiveCursor("x".repeat(513)), /Invalid archive cursor/);
  assert.throws(() => decodeArchiveCursor(Buffer.from(JSON.stringify({
    publicationDate: "invalid", rank: 1, id: "x",
  })).toString("base64url")), /Invalid archive cursor/);
});
