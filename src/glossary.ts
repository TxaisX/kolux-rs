// ONB-036: everyday words first on newcomer paths, the exact technical term on hover. One shared
// glossary pairs each banned technical word with the plain word shown instead, and also holds the
// Connect cards' how-it-works lines. `src/plainWords.test.ts` fails the build when a banned word
// shows on an in-scope screen.

/** The words a newcomer screen may not show (hover and explanation text may). */
export const BANNED = /\b(repos?|repositor(?:y|ies)|clon(?:e|es|ed|ing)|check-?outs?|worktrees?|shells?|CLIs?|PTYs?)\b/gi;

/** The banned words found in a piece of visible text, in order. */
export function jargon(text: string): string[] {
  return [...text.matchAll(BANNED)].map((m) => m[0]);
}

type Entry = { term: string; plain: string; hover: string };
export const GLOSSARY = {
  repository: { term: "Git repository", plain: "project", hover: "A project here is a folder Git tracks (a Git repository)" },
  clone: { term: "git clone", plain: "Copy from a web address", hover: "Copy from a web address: git clone downloads a Git repository from its URL" },
  worktree: { term: "Git worktree", plain: "workspace", hover: "A workspace is a branch in a folder of its own (a Git worktree)" },
  checkout: { term: "main checkout", plain: "main folder", hover: "The project's main folder (its main checkout)" },
  shell: { term: "shell", plain: "terminal", hover: "A terminal: a plain shell with no AI in it" },
  cli: { term: "CLI", plain: "program", hover: "The AI's own program on this PC (its CLI)" },
  pty: { term: "PTY", plain: "terminal", hover: "A terminal (a PTY, or pseudo-terminal)" },
} satisfies Record<string, Entry>;

/** The Connect cards' line saying what Connect does, per provider. */
export const CONNECT = {
  claude: "Connect opens Claude's sign-in page in your browser once and keeps a key that lasts a year.",
  codex: "Connect adds a ChatGPT account in a Codex home of Kolux's own; your Codex folder stays as it is.",
};
