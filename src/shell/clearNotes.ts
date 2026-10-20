// VIEW-072: clearing review notes asks first. One note clears at once (it is the same as deleting it); two or more ask.
export const needsConfirm = (count: number) => count > 1;

/** The question on the confirm step, e.g. "Clear 3 notes on src/a.ts?". */
export function clearQuestion(count: number, where?: string): string {
  const what = count === 1 ? "1 note" : `${count} notes`;
  return where ? `Clear ${what} on ${where}?` : `Clear ${what}?`;
}
