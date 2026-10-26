// VIEW-036 / TERM-002: the remove-session shortcut always asks before any pane closes, whatever the pane
// holds and whatever the "when a started session is removed" setting says (coordinator decision 2026-10-25:
// an empty chooser asks too). The close button keeps the quieter TERM-003 plan in terminal/remove.ts.
import { removeQuestion, type SessionKind } from "../terminal/remove";

export type RemoveAsk = { title: string; body: string; confirm: string };

export function removeShortcutAsk(name: string, kind: SessionKind): RemoveAsk {
  if (kind === "agent" || kind === "shell") return { ...removeQuestion(name, kind), confirm: "Stop" };
  return {
    title: `Remove “${name}”?`,
    body: kind === "unstarted" ? "No session has started in this pane yet. Removing it closes the pane." : "Nothing is running in this pane. Removing it closes the pane.",
    confirm: "Remove",
  };
}
