// ACCT-002: a connect choice is greyed out while its request is pending and comes back after 30
// seconds if no answer arrives, so a card can never hang.
export const PENDING_MS = 30_000;

/** Resolves once `p` settles or `ms` pass, whichever is first; never rejects. */
export function settleWithin(p: Promise<unknown>, ms = PENDING_MS): Promise<void> {
  return new Promise((done) => {
    const t = setTimeout(done, ms);
    p.then(
      () => {},
      () => {},
    ).finally(() => {
      clearTimeout(t);
      done();
    });
  });
}
