// after-list row 141 (TERM-063): which floating-panel tabs sit at an open prompt, read off each
// terminal's screen with the same Rust scan the window's panes use (prompt_scan). The panel's tabs
// have no pane key the hooks know, so the screen is the only place their wait can be seen.
export const SCAN_EVERY_MS = 1500;

export type Call = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

/** The tab keys whose terminal shows an open prompt; a tab with no terminal yet, or a scan that fails, counts as not waiting. */
export async function waitingTabs(call: Call, ptys: Record<number, number>): Promise<number[]> {
  const waiting: number[] = [];
  for (const [k, terminal] of Object.entries(ptys)) {
    if (!Number.isInteger(terminal)) continue;
    const scan = (await call("prompt_scan", { paneKey: Number(k), terminal }).catch(() => null)) as { prompt?: unknown } | null;
    if (scan?.prompt) waiting.push(Number(k));
  }
  return waiting;
}

/** The terminals of tabs that are still running a program; a tab whose program ended can no longer wait. */
export function liveTerminals(ptys: Record<number, number>, tabs: { key: number; exited?: boolean }[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of tabs) if (!t.exited && t.key in ptys) out[t.key] = ptys[t.key];
  return out;
}
