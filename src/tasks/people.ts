// GIT-053: mentions, reviewers and avatars. The people come from github_people (T-314-a), one list
// per GitHub host and repository, so people on different hosts never mix.
import type { Person } from "./repoFacts";

/** A login's characters (FIX-1's rule on the Rust side); what may follow the @ being typed. */
const LOGIN_PART = /^[A-Za-z0-9_-]*$/;

/** The mention being typed at the caret: the @ word just before it, or null. The @ must start the
 * text or follow a space, a line break or an opening bracket, so an email address is not a mention. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (!LOGIN_PART.test(query)) return null;
  if (at > 0 && !/[\s([{]/.test(before[at - 1])) return null;
  return { start: at, query };
}

/** People matching what follows the @: logins that start with it first, then ones that contain it,
 * each in GitHub's order, at most `limit`. */
export function mentionMatches(people: Person[], query: string, limit = 8): Person[] {
  const q = query.toLowerCase();
  const starts = people.filter((p) => p.login.toLowerCase().startsWith(q));
  const contains = people.filter((p) => !p.login.toLowerCase().startsWith(q) && p.login.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** The text with the mention at `start..caret` replaced by `@login ` and the caret after it. */
export function insertMention(text: string, start: number, caret: number, login: string): { text: string; caret: number } {
  const word = `@${login} `;
  const rest = text.slice(caret).replace(/^[A-Za-z0-9_-]*/, "");
  return { text: text.slice(0, start) + word + rest.replace(/^ /, ""), caret: start + word.length };
}

/** Up to this many reviewers can be requested on one pull request (GitHub's limit). */
export const MAX_REVIEWERS = 15;

/** GIT-053: asking `wanted` for a review on top of the requests already there. Existing requests are
 * kept and never asked again; when the total would pass the limit the whole request is refused. */
export function requestReviewers(existing: string[], wanted: string[]): { ok: true; add: string[] } | { ok: false; reason: string } {
  const have = new Set(existing.map((l) => l.toLowerCase()));
  const add: string[] = [];
  for (const w of wanted) {
    if (!have.has(w.toLowerCase())) {
      have.add(w.toLowerCase());
      add.push(w);
    }
  }
  if (existing.length + add.length > MAX_REVIEWERS) {
    return { ok: false, reason: `A pull request can have at most ${MAX_REVIEWERS} reviewers; it has ${existing.length} already.` };
  }
  return { ok: true, add };
}

/** What a person shows when there is no avatar (GitHub Enterprise without avatars): initials. */
export function initials(login: string): string {
  const parts = login.split(/[-_]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : login.slice(0, 2);
  return two.toUpperCase();
}
