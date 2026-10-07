export const HOME_WINDOW_DAYS = 7;
export const HOME_WINDOW_MS = HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function homeCutoffMs(anchorMs = Date.now()) {
  return anchorMs - HOME_WINDOW_MS;
}

export function homeCutoffIso(anchorMs = Date.now()) {
  return new Date(homeCutoffMs(anchorMs)).toISOString();
}

export function isHomePublicationDate(value: string, anchorMs = Date.now()) {
  const published = Date.parse(value);
  return Number.isFinite(published) &&
    published >= homeCutoffMs(anchorMs) &&
    published <= anchorMs;
}

export function isHistoryPublicationDate(value: string, anchorMs = Date.now()) {
  const published = Date.parse(value);
  return Number.isFinite(published) && published < homeCutoffMs(anchorMs);
}

export function clampHistoryBefore(before: string | undefined, anchorMs = Date.now()) {
  const cutoff = homeCutoffIso(anchorMs);
  if (!before) return cutoff;
  return Date.parse(before) < Date.parse(cutoff) ? new Date(before).toISOString() : cutoff;
}

export function clampHomeFrom(from: string | undefined, anchorMs = Date.now()) {
  const cutoff = homeCutoffIso(anchorMs);
  if (!from) return cutoff;
  return Date.parse(from) > Date.parse(cutoff) ? new Date(from).toISOString() : cutoff;
}
