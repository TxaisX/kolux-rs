// PROJ-035: the sidebar card that suggests adding a setup script. setup.rs (setup_suggestion) decides
// what to offer; this file turns that answer into the card's words and buttons.

export type SetupSuggestion =
  | { kind: "none" }
  | { kind: "install"; command: string; manager: string }
  | { kind: "import"; file: string; setup: string; skipped: string[] }
  | { kind: "error"; message: string };

export type CardView = {
  title: string;
  body: string;
  /** The script the card would save, shown so the choice is informed. */
  script?: string;
  /** Fields of the other tool's file that cannot come along. */
  skipped: string[];
  /** The id handed back to setup_suggestion_save; absent when there is nothing to save. */
  saveFrom?: string;
  saveLabel?: string;
  retry: boolean;
};

/** What the card shows, or null when it is not up (nothing to suggest). */
export function cardView(s: SetupSuggestion, project: string): CardView | null {
  switch (s.kind) {
    case "install":
      return { title: `Run ${s.command} for new workspaces?`, body: `${project} uses ${s.manager}. Save this as its setup script and every new workspace starts with it.`, script: s.command, skipped: [], saveFrom: "install", saveLabel: "Save as setup", retry: false };
    case "import":
      return { title: `Use the setup from ${s.file}?`, body: `${project} has a setup command from another tool. Kolux can keep it as this project's own setup.`, script: s.setup, skipped: s.skipped, saveFrom: s.file, saveLabel: "Save as setup", retry: false };
    case "error":
      return { title: "The shared setup file cannot be read", body: s.message, skipped: [], retry: true };
    default:
      return null;
  }
}

/** What `setup_suggestion_save` is called with: the folder, what the card offers, and the script it showed
 * (the save refuses when the project's file no longer gives that script). Null when there is nothing to save. */
export const saveArgs = (path: string, v: CardView): { path: string; from: string; shown: string } | null => (v.saveFrom && v.script !== undefined ? { path, from: v.saveFrom, shown: v.script } : null);

/** The line shown when something was left out of an import (shown on the card, before the save). */
export const skippedLine = (skipped: string[]): string | null => (skipped.length ? `Not supported, so left out: ${skipped.join(", ")}.` : null);
