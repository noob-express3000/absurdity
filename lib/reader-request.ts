import type { Story } from "./types";

// Keep the deadline active while consuming the body, not only until headers arrive.
// Use AbortController directly so older browsers do not need AbortSignal.any/timeout.
export async function readerRequest<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs = 35000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    return await consume(await fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

export function isReaderStory(value: unknown): value is Story {
  if (!value || typeof value !== "object") return false;
  const story = value as Story;
  return [story.id, story.title, story.detailedSummary, story.publicationDate, story.verificationNotes]
    .every(field => typeof field === "string") && Boolean(story.id && story.title) &&
    Array.isArray(story.sources) && story.sources.every(source => source &&
      typeof source.publisher === "string" && typeof source.url === "string");
}

export function isSourceUrl(value: string) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}
