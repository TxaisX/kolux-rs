// STAT-041: the words of a finish-and-bell note. The in-window toast and the desktop notification
// say the same thing; the window decides from a status change whether there is anything to say.
import type { AgentState } from "../projects/rows";

export type Turn = { state: AgentState; interrupted: boolean; boundary: boolean; reply?: string; child?: string };
export type Note = { what: string; body: string };

/** One line of a reply, cut to fit a notification. */
export function preview(reply: string): string {
  const line = reply.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * What a status change says about the pane, or null when it is not worth a note: session boundaries
 * and replayed events say nothing, nor does plain progress; a finish, a permission request, a block
 * and an interrupt do, and every sub-agent turn is a note of its own.
 */
export function turnNote(prev: AgentState | undefined, t: Turn): Note | null {
  if (t.boundary) return null;
  const body = t.reply ? preview(t.reply) : "";
  if (t.child) return { what: `${t.child} finished`, body };
  if (prev === t.state) return null;
  switch (t.state) {
    case "done":
      return prev === undefined ? null : { what: "finished", body };
    case "interrupted":
      return { what: "was interrupted", body: "" };
    case "permission":
      return { what: "needs permission", body: "" };
    case "blocked":
      return { what: "is blocked", body };
    default:
      return null;
  }
}

/** "repo · tab finished" when several repositories have agents running, else "tab finished". */
export function noteTitle(tab: string, repo: string | null, what: string): string {
  return `${repo ? `${repo} · ` : ""}${tab} ${what}`;
}
