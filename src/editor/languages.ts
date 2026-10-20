// EDIT-010 (T-316): colouring for Astro, Svelte, Vue, Nim and JSON Lines files, on top of the
// languages the editor already knows. Component files (Astro, Svelte, Vue) borrow the HTML
// language, which colours <script> and <style> sections in their own languages; JSON Lines is read
// one JSON value per line; Nim has its own small tokenizer. The tokenizers are written from the
// public language descriptions (JSON.org, the Nim manual's keyword list), nothing copied.
import { LanguageDescription, LanguageSupport, StreamLanguage, type StringStream } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

type Tok = string | null;

/** One line of JSON Lines: strings (a key when a colon follows), numbers, true/false/null, brackets. */
export function jsonLineToken(s: StringStream): Tok {
  if (s.eatSpace()) return null;
  if (s.match('"')) {
    while (!s.eol()) {
      const c = s.next();
      if (c === "\\") s.next();
      else if (c === '"') break;
    }
    return s.match(/^\s*:/, false) ? "propertyName" : "string";
  }
  if (s.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
  if (s.match(/^(true|false|null)\b/)) return "atom";
  if (s.match(/^[{}[\]]/)) return "bracket";
  s.next();
  return null;
}

const NIM_KEYWORDS = new Set(
  "addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield".split(" "),
);
const NIM_TYPES = new Set("int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float float32 float64 bool char string cstring seq array set openArray void auto any".split(" "));

// ponytail: single-line # comments and "..." strings only; #[ block comments and triple-quoted
// strings colour as plain text, add a state field when they matter.
export function nimToken(s: StringStream): Tok {
  if (s.eatSpace()) return null;
  if (s.match("#")) {
    s.skipToEnd();
    return "comment";
  }
  if (s.match('"') || s.match("'")) {
    const q = s.current();
    while (!s.eol()) {
      const c = s.next();
      if (c === "\\") s.next();
      else if (c === q) break;
    }
    return "string";
  }
  if (s.match(/^0[xX][\da-fA-F_]+|^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?('?[iuf]\d+)?/)) return "number";
  if (s.match(/^[A-Za-z_]\w*/)) {
    const w = s.current();
    return NIM_KEYWORDS.has(w) ? "keyword" : NIM_TYPES.has(w) ? "typeName" : null;
  }
  s.next();
  return null;
}

const html = languages.find((l) => l.name === "HTML");
const stream = (name: string, extensions: string[], token: (s: StringStream) => Tok) =>
  LanguageDescription.of({ name, extensions, load: async () => new LanguageSupport(StreamLanguage.define({ name, token })) });
const viaHtml = (name: string, extensions: string[]) => (html ? [LanguageDescription.of({ name, extensions, load: () => html.load() })] : []);

/** The editor's languages: the built-in set plus the five above. */
export const allLanguages: readonly LanguageDescription[] = [...viaHtml("Astro", ["astro"]), ...viaHtml("Svelte", ["svelte"]), stream("Nim", ["nim", "nims", "nimble"], nimToken), stream("JSON Lines", ["jsonl", "ndjson"], jsonLineToken), ...languages];

/** The language a file name gets, or null for plain text. */
export const languageFor = (name: string) => LanguageDescription.matchFilename(allLanguages, name) ?? LanguageDescription.matchFilename(allLanguages, name.toLowerCase());
