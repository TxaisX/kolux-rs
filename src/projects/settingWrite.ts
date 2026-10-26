// Settings writes made before the page has rendered the last one (a click right after a click).

export type Settings = Record<string, unknown>;

/** Lays `patch` over the latest settings and returns both sides for saving.
 * The cell moves on at once, so a second write before the next render builds on the first. */
export function applySettings(cell: { current: Settings }, patch: Settings): { was: Settings; next: Settings } {
  const was = cell.current;
  const next = { ...was, ...patch };
  cell.current = next;
  return { was, next };
}

export const applySetting = (cell: { current: Settings }, key: string, value: unknown) => applySettings(cell, { [key]: value });

const isPlain = (v: unknown): v is Settings => typeof v === "object" && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge: what `next` changed from `base`, laid over `now` (objects are merged key by key). */
function merge(base: unknown, next: unknown, now: unknown): unknown {
  if (!isPlain(next) || !(base === undefined || isPlain(base)) || !(now === undefined || isPlain(now))) return next;
  const was = base ?? {};
  const out: Settings = { ...now };
  for (const k of Object.keys(was)) if (!(k in next)) delete out[k];
  for (const k of Object.keys(next)) if (!same(was[k], next[k])) out[k] = merge(was[k], next[k], out[k]);
  return out;
}

/** For a page that hands back a whole settings object built from the settings it rendered (`base`):
 * keeps only what it changed and lays that over the latest settings, so an earlier write is not undone. */
export function rebaseSettings(cell: { current: Settings }, base: Settings, built: Settings): { was: Settings; next: Settings } {
  const was = cell.current;
  const next = merge(base, built, was) as Settings;
  cell.current = next;
  return { was, next };
}

/** What a panel has written since its last render, so a choice computed from "the settings" sees it. */
export function pendingWrites() {
  let sent: Settings = {};
  return {
    reset: () => void (sent = {}),
    put: (key: string, value: unknown) => void (sent[key] = value),
    latest: (rendered: Settings): Settings => ({ ...rendered, ...sent }),
  };
}
