// ONB-036: everyday words first on newcomer paths, the exact technical term on hover. One shared
// glossary pairs each banned technical word with the plain word shown instead, and also holds the
// Connect cards' how-it-works lines. The plain words and hover lines are read through the text
// lookup (SET-017, `src/i18n/lookup.ts`), so they follow the interface language with English as the
// fallback. `src/plainWords.test.ts` fails the build when a banned word shows on an in-scope screen.

import { t } from "./i18n/lookup";
import type { TextKey } from "./i18n/en";

/** The words a newcomer screen may not show (hover and explanation text may). */
export const BANNED = /\b(repos?|repositor(?:y|ies)|clon(?:e|es|ed|ing)|check-?outs?|worktrees?|shells?|CLIs?|PTYs?)\b/gi;

/** The banned words found in a piece of visible text, in order. */
export function jargon(text: string): string[] {
  return [...text.matchAll(BANNED)].map((m) => m[0]);
}

type Entry = { term: string; plain: string; hover: string };
/** A glossary entry whose plain word and hover line come from the lookup each time they are read. */
const entry = (id: string, term: string): Entry => ({
  term,
  get plain() { return t(`glossary.${id}.plain` as TextKey); },
  get hover() { return t(`glossary.${id}.hover` as TextKey); },
});

export const GLOSSARY = {
  repository: entry("repository", "Git repository"),
  clone: entry("clone", "git clone"),
  worktree: entry("worktree", "Git worktree"),
  checkout: entry("checkout", "main checkout"),
  shell: entry("shell", "shell"),
  cli: entry("cli", "CLI"),
  pty: entry("pty", "PTY"),
} satisfies Record<string, Entry>;

/** The Connect cards' line saying what Connect does, per provider. */
export const CONNECT = {
  get claude() { return t("connect.claude"); },
  get codex() { return t("connect.codex"); },
};
