// Pairs each right-click wait with the engine's answer. The host numbers the requests it handles
// (1, 2, ...); an answer is used only for the wait that expects that number, so a late answer to an
// earlier right-click never lands on the next field.
const MAX_OWED = 2;

export class SuggestionGate {
  private seen = 0;
  /** Waits that gave up while their answer may still arrive. */
  private owed = 0;
  private tag: number | null = null;
  /** An answer for another number arrived while the wait was open. */
  private stray = false;

  /** A new right-click; returns nothing, the wait expects the next number after any owed ones. */
  begin(): void {
    if (this.tag !== null) this.timedOut();
    this.tag = this.seen + 1 + this.owed;
    this.stray = false;
  }

  /** The answer numbered `seq` arrived; true when it belongs to the open wait. */
  answer(seq: number): boolean {
    const mine = this.tag === seq;
    if (seq > this.seen) this.seen = seq;
    // Answers come in order: if ours arrived, anything owed before it was never handled.
    this.owed = mine ? 0 : Math.max(0, this.owed - 1);
    if (mine) this.tag = null;
    else if (this.tag !== null) this.stray = true;
    return mine;
  }

  /** The wait gave up; its answer is now owed and will be dropped when it comes. */
  timedOut(): void {
    if (this.tag === null) return;
    this.tag = null;
    // A stray answer was most likely this wait's own, numbered differently: nothing more is owed.
    if (!this.stray) this.owed = Math.min(MAX_OWED, this.owed + 1);
  }
}
