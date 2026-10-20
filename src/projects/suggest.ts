// PROJ-023: the create flow opens with a sea-creature name already in the name field. A name the
// user has changed is never replaced by a newer suggestion; one they never touched is.

/** What the name field holds after `incoming` arrives. `shown` is the last suggestion put in the
 *  field (null before any). An untouched field (empty before any suggestion, or still equal to
 *  `shown`) takes the new name; anything else, a cleared field included, is the user's and stays. */
export function takeSuggestion(current: string, shown: string | null, incoming: string): string {
  if (!incoming) return current;
  if (shown === null) return current === "" ? incoming : current;
  return current === shown ? incoming : current;
}
