// EDIT-010 (T-234-b): the language label of a code block in the rich view. A block shows its language and
// a small choice list changes it; a language the list does not know is shown as typed with a plain-text
// choice next to it, and plain text writes the fence with no label. Colouring of the words is not done
// here (the rich view has no tokenizer); the label is what the note's fence carries.
import { $getNodeByKey, $getRoot, $isElementNode, type LexicalEditor, type LexicalNode } from "lexical";
import { $isCodeNode } from "@lexical/code";

/** Fence labels offered in the choice list: [label written in the fence, name shown]. */
export const CODE_LANGUAGES: [string, string][] = [
  ["", "Plain text"],
  ["bash", "Shell"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["diff", "Diff"],
  ["go", "Go"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["markdown", "Markdown"],
  ["mermaid", "Mermaid"],
  ["php", "PHP"],
  ["powershell", "PowerShell"],
  ["python", "Python"],
  ["ruby", "Ruby"],
  ["rust", "Rust"],
  ["sql", "SQL"],
  ["swift", "Swift"],
  ["toml", "TOML"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
  ["yaml", "YAML"],
];

/** Short spellings people type in a fence, and the label each one means. */
const ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", rs: "rust", sh: "bash", shell: "bash", zsh: "bash",
  ps1: "powershell", pwsh: "powershell", yml: "yaml", md: "markdown", rb: "ruby", "c++": "cpp", "c#": "csharp", cs: "csharp", golang: "go", kt: "kotlin",
  text: "", txt: "", plain: "", plaintext: "",
};

/** The label a fence language stands for: lower-cased and short spellings resolved ("TS" is typescript). */
export function canonLanguage(lang: string | null | undefined): string {
  const l = (lang ?? "").trim().toLowerCase();
  return l in ALIASES ? ALIASES[l] : l;
}

/** True when the list has no entry for this fence language (the block then offers Plain text). */
export const unknownLanguage = (lang: string | null | undefined): boolean => !CODE_LANGUAGES.some(([id]) => id === canonLanguage(lang));

/** What the label shows for a fence language. */
export function languageName(lang: string | null | undefined): string {
  const c = canonLanguage(lang);
  const hit = CODE_LANGUAGES.find(([id]) => id === c);
  return hit ? hit[1] : `${(lang ?? "").trim()} (not recognised)`;
}

/** The choice list for a block: the list itself, with an unknown language kept as the first entry so it can be left as it is. */
export function languageChoices(lang: string | null | undefined): { id: string; name: string }[] {
  const base = CODE_LANGUAGES.map(([id, name]) => ({ id, name }));
  return unknownLanguage(lang) ? [{ id: (lang ?? "").trim(), name: languageName(lang) }, ...base] : base;
}

/** Sets the fence language of the code block with this node key as one edit. "" (or a plain-text spelling) writes a fence with no label. */
export function setCodeLanguage(editor: LexicalEditor, key: string, lang: string): boolean {
  let done = false;
  editor.update(
    () => {
      const n = $getNodeByKey(key);
      if (!$isCodeNode(n)) return;
      n.setLanguage(unknownLanguage(lang) ? lang.trim() : canonLanguage(lang));
      done = true;
    },
    { discrete: true },
  );
  return done;
}

/** The code blocks of the note in document order: node key, element and fence language. */
export function codeBlocks(editor: LexicalEditor): { key: string; el: HTMLElement | null; language: string }[] {
  return editor.getEditorState().read(() => {
    const out: { key: string; el: HTMLElement | null; language: string }[] = [];
    const walk = (n: LexicalNode) => {
      if ($isCodeNode(n)) {
        const el = editor.getElementByKey(n.getKey());
        out.push({ key: n.getKey(), el, language: n.getLanguage() ?? "" });
        return;
      }
      if ($isElementNode(n)) n.getChildren().forEach(walk);
    };
    walk($getRoot());
    return out;
  });
}
