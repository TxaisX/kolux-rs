// SET-017: Kolux's own words in English, the language every other pack falls back to. A key ending
// in `.hover` is hover or explanation text, which may name the exact technical term (ONB-036);
// every other key is text shown on screen and must pass the plain-words guard in every language.
// Product and provider names (Claude, Codex, ChatGPT, Git, Kolux) stay as they are in every pack.

export const EN = {
  "glossary.repository.plain": "project",
  "glossary.repository.hover": "A project here is a folder Git tracks (a Git repository)",
  "glossary.clone.plain": "Copy from a web address",
  "glossary.clone.hover": "Copy from a web address: git clone downloads a Git repository from its URL",
  "glossary.worktree.plain": "workspace",
  "glossary.worktree.hover": "A workspace is a branch in a folder of its own (a Git worktree)",
  "glossary.checkout.plain": "main folder",
  "glossary.checkout.hover": "The project's main folder (its main checkout)",
  "glossary.shell.plain": "terminal",
  "glossary.shell.hover": "A terminal: a plain shell with no AI in it",
  "glossary.cli.plain": "program",
  "glossary.cli.hover": "The AI's own program on this PC (its CLI)",
  "glossary.pty.plain": "terminal",
  "glossary.pty.hover": "A terminal (a PTY, or pseudo-terminal)",
  "inbox.bell.needs.one": "Inbox, {count} needs you",
  "inbox.bell.needs.many": "Inbox, {count} need you",
  "connect.claude": "Connect opens Claude's sign-in page in your browser once and keeps a key that lasts a year.",
  "connect.codex": "Connect adds a ChatGPT account in a Codex home of Kolux's own; your Codex folder stays as it is.",
  "onboarding.connect.wait": "Connect an AI above to continue, or choose “I’ll do this later”.",
} as const;

export type TextKey = keyof typeof EN;
