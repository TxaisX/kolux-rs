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

/** What the control on a comment card offers. GitHub's own bots (a card marked bot whose author is not on the list) offer nothing. */
export function botToggle(cardIsBot: boolean, author: string, list: readonly string[]): "mark" | "unmark" | null {
  if (onBotList(author, list)) return "unmark";
  return cardIsBot ? null : "mark";
}

/** The list as of the latest click, so two clicks before the page redraws both count. */
export type BotCell = { current: readonly string[] };

/** One Mark as bot / Not a bot click on `cell`. A mark the list cannot take says why and changes nothing. */
export function toggleBotIn(cell: BotCell, author: string): { list: string[]; changed: boolean; marked: boolean; note: string | null } {
  const was = [...cell.current];
  if (onBotList(author, was)) {
    cell.current = withoutBot(was, author);
    return { list: [...cell.current], changed: true, marked: false, note: null };
  }
  const next = withBot(was, author);
  if (next.length === was.length) {
    const note = was.length >= MAX_BOTS ? `The bot list is full (${MAX_BOTS} names): take one off in Settings > Git first.` : `"${author}" cannot be added to the bot list.`;
    return { list: was, changed: false, marked: true, note };
  }
  cell.current = next;
  return { list: next, changed: true, marked: true, note: null };
}

type Carded = { author: string; bot: boolean };

/** A read review with every card by `author` (any case) shown as a bot, without reading it again; the input is not changed. */
export function relabelAsBot<R extends { threads: { comments: Carded[] }[]; talk: Carded[] }>(review: R, author: string): R {
  const same = (a: string) => a.toLowerCase() === author.toLowerCase();
  const mark = <C extends Carded>(c: C): C => (same(c.author) ? { ...c, bot: true } : c);
  return { ...review, threads: review.threads.map((t) => ({ ...t, comments: t.comments.map(mark) })), talk: review.talk.map(mark) };
}
