// T-569 (Txais 2026-10-28): a workspace with no pane yet starts with the launch chooser in its first cell,
// not a terminal: nothing runs until the person picks an AI session or a plain terminal. A freshly made
// workspace gets as many choosers as the default pane count. Panes restored from the saved layout never come here.
import type { Pane } from "../App";
import { emptySeat } from "../launch/seats";

export function startPanes(dir: string, branch: string | null, count: number, nextKey: () => number): Pane[] {
  return Array.from({ length: Math.max(1, count) }, (_, i): Pane => ({ key: nextKey(), cwd: dir, branch: i === 0 ? branch : null, agent: "shell", program: null, args: [], seats: [emptySeat()] }));
}
