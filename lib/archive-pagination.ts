// Stable cursor for the story archive, independent of offset shifts caused by new stories.
export type ArchivePosition = { publicationDate: string; rank: number; id: string };

export function encodeArchiveCursor(position: ArchivePosition): string {
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

export function decodeArchiveCursor(value: string | null | undefined): ArchivePosition | null {
  if (!value) return null;
  if (value.length > 512) throw new Error("Invalid archive cursor.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Bad cursor.");
    const cursor = parsed as Partial<ArchivePosition>;
    if (typeof cursor.publicationDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.publicationDate) ||
        !Number.isFinite(Date.parse(cursor.publicationDate)) ||
        typeof cursor.rank !== "number" || !Number.isFinite(cursor.rank) ||
        typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200) {
      throw new Error("Bad cursor.");
    }
    return { publicationDate: cursor.publicationDate, rank: cursor.rank, id: cursor.id };
  } catch {
    throw new Error("Invalid archive cursor.");
  }
}

// Mirrors the SQL ordering: publication_date DESC, rank ASC, id ASC.
export function archivePositionIsAfter(value: ArchivePosition, cursor: ArchivePosition): boolean {
  return value.publicationDate < cursor.publicationDate ||
    (value.publicationDate === cursor.publicationDate && (value.rank > cursor.rank ||
      (value.rank === cursor.rank && value.id > cursor.id)));
}
