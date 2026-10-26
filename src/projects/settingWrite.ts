// Settings writes made before the page has rendered the last one (a click right after a click).

export type Settings = Record<string, unknown>;

/** Lays `value` over the latest settings and returns both sides for saving.
 * The cell moves on at once, so a second write before the next render builds on the first. */
export function applySetting(cell: { current: Settings }, key: string, value: unknown): { was: Settings; next: Settings } {
  const was = cell.current;
  const next = { ...was, [key]: value };
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
