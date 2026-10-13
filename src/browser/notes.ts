// BROW-037: the notes a page's annotation form saves, and the one Markdown message an agent
// gets for them. Page text is data in that message, never markup: a code fence is lengthened
// past any fence the text holds, line breaks inside one-line fields fold to spaces, and long
// text is cut on a character boundary (never inside a surrogate pair).

/** One saved note, as the page's form sends it (`browser_annotate.rs`). */
export type Note = {
  url: string;
  selector: string;
  tag: string;
  text: string;
  html: string;
  components: string[];
  sources: string[];
  styles: Record<string, string>;
  intent: string;
  comment: string;
  at: string;
};

/** How many notes a page may hold at once. */
export const CAP = 20;

const INTENT: Record<string, string> = { change: "Change", bug: "Broken", question: "Question", remove: "Remove", keep: "Note" };

/** Cuts `s` to at most `max` characters without splitting a surrogate pair. */
export function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // a high surrogate would be left alone
  return s.slice(0, end) + "…";
}

/** Line breaks and runs of blank space become one space: the text stays on its line. */
export const fold = (s: string): string => s.replace(/\s+/g, " ").trim();

/** A code fence longer than any run of backticks inside `s`, so `s` cannot close it. */
export function fence(s: string): string {
  const longest = Math.max(2, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(longest + 1);
}

/** The one Markdown message for a page's notes; empty when there are none (nothing is sent). */
export function notesMarkdown(notes: Note[]): string {
  if (notes.length === 0) return "";
  const url = fold(notes[0].url);
  const lines = [`Page notes (${notes.length}) from ${url}`, ""];
  notes.forEach((n, i) => {
    const what = INTENT[n.intent] ?? fold(n.intent);
    lines.push(`${i + 1}. **${what}** — \`${fold(n.selector).replace(/`/g, "'")}\``);
    if (n.comment) lines.push(`   ${cut(fold(n.comment), 2000)}`);
    if (n.text) lines.push(`   - text: ${cut(fold(n.text), 200)}`);
    if (n.components.length) lines.push(`   - components: ${n.components.map(fold).join(" < ")}`);
    if (n.sources.length) lines.push(`   - source hints: ${n.sources.map(fold).join(", ")}`);
    const styles = Object.entries(n.styles).map(([k, v]) => `${k}: ${fold(v)}`);
    if (styles.length) lines.push(`   - styles: ${cut(styles.join("; "), 600)}`);
    if (n.html) {
      const f = fence(n.html);
      lines.push(`   ${f}html`, `   ${cut(fold(n.html), 400)}`, `   ${f}`);
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}
