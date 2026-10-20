// ONB-042: one-time hints for a control that moved. A hint reaches only a profile whose record shows
// it used the control before it moved (first use earlier than the move), never a profile born after,
// and each shows once (the tips list keeps it seen). The has-used record is features.ts / onboarding.rs.
import type { Features } from "./features";

export type MovedId = "moved-usage";

/** A control that moved. `feature` is the use the record keeps for it; `before` is when it moved (ms since 1970).
 *  Design call (coordinator default; Txais may overrule): the status-bar usage chips went to the weekly pill
 *  and the pane headers on 2026-10-05 (VIEW-102), the one move the onboarding spec's has-used list covers. */
export const MOVED: { id: MovedId; feature: string; before: number; title: string; text: string }[] = [
  {
    id: "moved-usage",
    feature: "usage",
    before: Date.UTC(2026, 9, 5),
    title: "Usage moved",
    text: "Your usage now shows in the weekly pill at the top right, and each session's usage sits in its pane header.",
  },
];

/** The moved-control hint to show, or null: the profile used the control before it moved and has not seen the hint. */
export function movedHint(features: Features | undefined, seen: readonly string[]): MovedId | null {
  const f = features ?? {};
  return MOVED.find((m) => !seen.includes(m.id) && (f[m.feature]?.count ?? 0) > 0 && f[m.feature].first < m.before)?.id ?? null;
}

/** ONB-015: the retired split-terminal Setup Guide step's own id, kept in older profiles' tried list. */
export const SPLIT_STEP = "split-terminal";
/** The Setup Guide dropped the split-terminal step on this date (2026-10-04, ONB-041). */
export const SPLIT_RETIRED = Date.UTC(2026, 9, 4);

/** ONB-015 / ONB-042: the legacy split-pane credit. A profile that finished the retired split-terminal
 *  step, or split a pane (the has-used record) before that step went away, keeps its Multi-task tick.
 *  Design call (coordinator default; Txais may overrule). */
export function splitCredit(tried: readonly string[] | undefined, features: Features | undefined): boolean {
  const s = features?.split;
  return !!tried?.includes(SPLIT_STEP) || (!!s && s.count > 0 && s.first < SPLIT_RETIRED);
}
