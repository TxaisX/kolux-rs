// After-list row 789: what startup recovery repaired or set aside, as sentences for one dismissible notice.

/** Asks the back end for the sentences; a failed ask is no notice, never an error page. */
export async function loadRecoveryNotes(ask: () => Promise<unknown>): Promise<string[]> {
  try {
    const got = await ask();
    return Array.isArray(got) ? got.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
  } catch {
    return [];
  }
}
