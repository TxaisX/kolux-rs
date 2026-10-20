// ONB-036: everyday words first on newcomer paths, the exact technical term on hover. One shared
// glossary pairs each banned technical word with the plain word shown instead, and also holds the
// Connect cards' how-it-works lines. The plain words and hover lines are read through the text
// lookup (SET-017, `src/i18n/lookup.ts`), so they follow the interface language with English as the
// fallback. `src/plainWords.test.ts` fails the build when a banned word shows on an in-scope screen.

import { t } from "./i18n/lookup";
import type { TextKey } from "./i18n/en";

/** The ids that have both a plain word and a hover line in English, read off the English keys so a typo is a compile error. */
export type GlossaryId = { [K in TextKey]: K extends `glossary.${infer I}.plain` ? (`glossary.${I}.hover` extends TextKey ? I : never) : never }[TextKey];

/** The words a newcomer screen may not show (hover and explanation text may). */
export const BANNED = /\b(repos?|repositor(?:y|ies)|clon(?:e|es|ed|ing)|check-?outs?|worktrees?|shells?|CLIs?|PTYs?)\b/gi;

/** The banned words found in a piece of visible text, in order. */
export function jargon(text: string): string[] {
  return [...text.matchAll(BANNED)].map((m) => m[0]);
}

type Entry = { term: string; plain: string; hover: string };
/** A glossary entry whose plain word and hover line come from the lookup each time they are read. */
export const glossaryEntry = (id: GlossaryId, term: string): Entry => ({
  term,
  get plain() { return t(`glossary.${id}.plain`); },
  get hover() { return t(`glossary.${id}.hover`); },
});

export const GLOSSARY = {
  repository: glossaryEntry("repository", "Git repository"),
  clone: glossaryEntry("clone", "git clone"),
  worktree: glossaryEntry("worktree", "Git worktree"),
  checkout: glossaryEntry("checkout", "main checkout"),
  shell: glossaryEntry("shell", "shell"),
  cli: glossaryEntry("cli", "CLI"),
  pty: glossaryEntry("pty", "PTY"),
} satisfies Record<string, Entry>;

/** The Connect cards' line saying what Connect does, per provider. */
export const CONNECT = {
  get claude() { return t("connect.claude"); },
  get codex() { return t("connect.codex"); },
};
