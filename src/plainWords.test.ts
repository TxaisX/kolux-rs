// ONB-036: the text newcomers see on their paths never uses the banned technical words; hover
// text may carry them. This scans the source of every in-scope screen (all states at once, not
// one render): JSX text, the visible attributes, strings shown from inside JSX, toast messages
// and the Connect cards' headline/detail lines. A banned word found there fails `pnpm test`.
// ponytail: a syntax scan, so text built far from the JSX (a helper in another file) is only
// caught when that file is listed here; add the onboarding wizard and the no-Git dialog when
// they reach this lane (T-209-b).
import { expect, test } from "vitest";
import ts from "typescript";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { BANNED, GLOSSARY, jargon, CONNECT } from "./glossary";
import { AddProjectView } from "./projects/AddProject";

/** In-scope screens: Add Project, the launcher, the sidebar, the Connect cards, error toasts. */
const SOURCES = import.meta.glob(
  [
    "./projects/AddProject.tsx",
    "./projects/ProjectsPanel.tsx",
    "./launch/ChooserPane.tsx",
    "./launch/PlusMenu.tsx",
    "./settings/SettingsPage.tsx",
    "./settings/claudeKey.ts",
    "./settings/CodexCard.tsx",
    "./settings/ClaudeAccounts.tsx",
    "./settings/AccountRow.tsx",
    "./settings/Attention.tsx",
    "./settings/SignInNotice.tsx",
    "./settings/KeyLostNotice.tsx",
    "./App.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const SCREENS = Object.keys(SOURCES);
/** Only these attributes are read as text on screen; title and aria-label are hover/explanation. */
const SHOWN_ATTRS = new Set(["placeholder", "alt"]);
/** Calls whose text lands in a toast or notice line. */
const TOASTS = new Set(["say", "setNotice", "setMessage", "setError"]);
/** Object fields the Connect cards print as their headline and detail lines. */
const SHOWN_FIELDS = new Set(["headline", "detail", "text"]);
/** Files whose JSX is not a newcomer screen as a whole; only their toasts count. */
const TOASTS_ONLY = new Set(["./App.tsx"]);
/** SettingsPage also holds pages beyond the Connect cards (project pages, the settings list). */
const CARDS_ONLY: Record<string, (n: ts.Node) => boolean> = {
  "./settings/SettingsPage.tsx": (n) => ts.isFunctionDeclaration(n) && n.name?.text === "ClaudeCardView",
};

function compared(n: ts.Node): boolean {
  const p = n.parent;
  if (ts.isBinaryExpression(p)) return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind);
  return ts.isCaseClause(p) || ts.isLiteralTypeNode(p) || ts.isElementAccessExpression(p) || ts.isImportDeclaration(p) || ts.isPropertyAssignment(p) && p.name === n;
}

function shownText(file: string): string[] {
  const src = SOURCES[file];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const jsxToo = !TOASTS_ONLY.has(file);
  const visit = (n: ts.Node, shown: boolean): void => {
    if (ts.isJsxText(n)) { if (jsxToo) out.push(n.text); return; }
    if (ts.isJsxAttribute(n)) {
      if (jsxToo && SHOWN_ATTRS.has(n.name.getText()) && n.initializer) visit(n.initializer, true);
      return;
    }
    if (shown && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) { if (!compared(n)) out.push(n.text); return; }
    if (shown && ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    let next = shown;
    if (ts.isJsxExpression(n) && jsxToo && !ts.isJsxAttribute(n.parent)) next = true;
    if (ts.isCallExpression(n) && TOASTS.has(n.expression.getText())) { n.arguments.forEach((a) => visit(a, true)); return; }
    if (ts.isPropertyAssignment(n) && SHOWN_FIELDS.has(n.name.getText()) && !file.endsWith(".tsx")) next = true;
    ts.forEachChild(n, (c) => visit(c, next));
  };
  const pick = CARDS_ONLY[file];
  if (pick) ts.forEachChild(sf, (n) => { if (pick(n)) visit(n, false); else ts.forEachChild(n, function toasts(c): void { if (ts.isCallExpression(c) && TOASTS.has(c.expression.getText())) visit(c, false); else ts.forEachChild(c, toasts); }); });
  else visit(sf, false);
  return out;
}

test("ONB-036: no banned word in the text shown on a newcomer screen", () => {
  expect(SCREENS).toHaveLength(13); // a renamed file must not drop out of the scan silently
  const found = SCREENS.flatMap((f) => shownText(f).flatMap((t) => jargon(t).map((w) => `${f}: "${w}" in "${t.trim()}"`)));
  expect(found).toEqual([]);
});

test("ONB-036: the scan does find a banned word, and leaves product names alone", () => {
  expect(jargon("Clone the repo, open a shell, run the CLI on a PTY, check the worktree")).toEqual(["Clone", "repo", "shell", "CLI", "PTY", "worktree"]);
  expect(jargon("PowerShell, GitHub and Git Bash")).toEqual([]);
  expect(BANNED.flags).toContain("i");
});

test("ONB-036: one glossary pairs each technical term with its plain word, and feeds the Connect cards", () => {
  for (const [term, e] of Object.entries(GLOSSARY)) {
    expect(jargon(e.plain), term).toEqual([]);
    expect(e.hover.toLowerCase(), term).toContain(e.term.toLowerCase());
  }
  for (const line of Object.values(CONNECT)) expect(jargon(line)).toEqual([]);
});

test("ONB-036: hovering the plain Add Project choice shows the technical term", () => {
  const html = renderToString(createElement(AddProjectView, { step: "choose", onStep: () => {}, onBrowse: () => {}, onClose: () => {} }));
  expect(html).toContain(`title="${GLOSSARY.clone.hover}"`);
  expect(GLOSSARY.clone.hover).toMatch(/git clone/i);
});
