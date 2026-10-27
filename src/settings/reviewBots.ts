// ACCT-058 (T-311): the list of review-comment authors the user marks as bots (Settings > Git). The
// backend (pr_review.rs) marks a comment as a bot when GitHub says its author is one or when the author's
// login equals a listed name, ignoring case; this file turns what the user types into that list.

/** Longest list and longest name kept; a GitHub login is at most 39 characters. */
export const MAX_BOTS = 50;
export const MAX_NAME = 60;

/** The names in `text` (commas, spaces, semicolons or new lines between them), tidied so they match the
 * author names the backend sees: no leading @, no "[bot]" ending, letters/digits/dash/dot/underscore only,
 * each name once whatever its case. */
export function parseBots(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const name = raw.replace(/^@+/, "").replace(/\[bot\]$/i, "");
    if (name === "" || name.length > MAX_NAME || !/^[\w.-]+$/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_BOTS) break;
  }
  return out;
}

/** The list as the field shows it. */
export const botsText = (list: unknown): string => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").join(", ") : "");

/** Whether an author is on the list (same rule as the backend: the whole name, any case). */
export const onBotList = (author: string, list: readonly string[]): boolean => list.some((b) => b.toLowerCase() === author.toLowerCase());

/** The list with one more author (tidied like typed names, once whatever its case); a name that does not tidy to one changes nothing. */
export function withBot(list: readonly string[], author: string): string[] {
  const one = parseBots(author);
  return one.length === 1 && !onBotList(one[0], list) ? parseBots([...list, one[0]].join(" ")) : [...list];
}

/** The list without that author, whatever its case. */
export const withoutBot = (list: readonly string[], author: string): string[] => list.filter((b) => b.toLowerCase() !== author.toLowerCase());
