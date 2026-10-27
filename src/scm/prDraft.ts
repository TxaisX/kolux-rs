// Row 76 (VIEW-074 / GIT-024): the AI draft button in the Checks pull request composer. It asks the
// same text writer the one-click flow uses (oneClick.ts realPorts.text), one run per worktree.
import { writerOf } from "./generate";
import { realPorts } from "./oneClick";
import { aiShownFor } from "./recipes";

export type DraftResult = { state: "filled"; title: string; body: string } | { state: "failed"; message: string } | { state: "busy" };

const running = new Set<string>();
export const draftRunning = (dir: string): boolean => running.has(dir);

/** The button shows under the Source Control writer switches: the AI switch for this repository, and a writer that is not off. */
export const draftOffered = (settings: Record<string, unknown>, repo: string | null): boolean => aiShownFor(settings, repo) && writerOf(settings).mode !== "off";

/** Writes a title and description for `dir` against `base`; a second ask for the same worktree while one runs is `busy` and calls nothing. */
export async function draftPrText(dir: string, base: string, settings: Record<string, unknown>): Promise<DraftResult> {
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
