// Row 76 (VIEW-074 / GIT-024): the AI draft button in the Checks pull request composer. It asks the
// same text writer the one-click flow uses (oneClick.ts realPorts.text), one run per worktree.
import { writerOf, writerUsable } from "./generate";
import { realPorts } from "./oneClick";
import { aiShownFor } from "./recipes";

export type DraftResult = { state: "filled"; title: string; body: string } | { state: "failed"; message: string } | { state: "busy" } | { state: "off" };

const running = new Set<string>();
export const draftRunning = (dir: string): boolean => running.has(dir);

export type DraftGate = { repo: string | null; agents: ReadonlyArray<{ id: string; installed: boolean }> };

/** The button shows under the Source Control writer rules: the AI switch for this repository, a writer that is not off, and that writer usable (agent installed or custom command). */
export const draftOffered = (settings: Record<string, unknown>, repo: string | null, agents: DraftGate["agents"]): boolean =>
  aiShownFor(settings, repo) && writerUsable(writerOf(settings), agents, null);

/** Writes a title and description for `dir` against `base`. It re-checks the gate on the settings it is given, so a switch turned off after the composer opened is `off` and calls nothing; a second ask for the same worktree while one runs is `busy` and calls nothing. */
export async function draftPrText(dir: string, base: string, settings: Record<string, unknown>, gate: DraftGate): Promise<DraftResult> {
  if (!draftOffered(settings, gate.repo, gate.agents)) return { state: "off" };
  if (running.has(dir)) return { state: "busy" };
  running.add(dir);
  try {
    const [title, body] = await realPorts(writerOf(settings)).text(dir, base);
    return title.trim() === "" ? { state: "failed", message: "The writer came back without a title." } : { state: "filled", title: title.trim(), body };
  } catch (err) {
    return { state: "failed", message: String(err) };
  } finally {
    running.delete(dir);
  }
}

/** The composer after a draft: only a filled draft changes it; a failure or a busy answer leaves the user's text as it is. */
export const applyDraft = <T extends { title: string; body: string }>(d: T, r: DraftResult): T => (r.state === "filled" ? { ...d, title: r.title, body: r.body } : d);

/** The fields as they were when the button was clicked; text typed while the draft ran is never overwritten. */
type Fields = { title: string; body: string };

/** Fills each field only if it still equals its click-time snapshot; `note` says what was kept when the user edited during the run. */
export function applyIfUnchanged<T extends Fields>(cur: T, snap: Fields, r: DraftResult): { draft: T; note: string | null } {
  if (r.state !== "filled") return { draft: cur, note: null };
  const titleKept = cur.title !== snap.title;
  const bodyKept = cur.body !== snap.body;
  if (!titleKept && !bodyKept) return { draft: applyDraft(cur, r), note: null };
  const draft = { ...cur, title: titleKept ? cur.title : r.title, body: bodyKept ? cur.body : r.body };
  const kept = titleKept && bodyKept ? "title and description" : titleKept ? "title" : "description";
  return { draft: titleKept && bodyKept ? cur : draft, note: `The draft was not applied to the ${kept} because you edited it while it was being written.` };
}
