// The second line of a workspace card in the sidebar (PROJ-062): the shown details' words, muted,
// under the name. Nothing is drawn when the preset shows nothing or there is nothing to say.
import { cardLine, type CardFacts } from "./cards";

/** Where the line starts: under the workspace name in a top-level row, and one step further in for each level a nested workspace sits at (the same 14px step as the rows). One place, so a change to the row layout is one change here. */
export const CARD_INDENT = 44;
export const CARD_STEP = 14;
export const cardIndent = (depth: number): number => CARD_INDENT + Math.max(0, depth) * CARD_STEP;

/** `depth` is the nesting level; `indent` (pixels) is the older way and wins when given, so the sidebar can move over with its own hunk. */
export default function CardLine({ shown, facts, depth = 0, indent }: { shown: readonly string[]; facts: CardFacts; depth?: number; indent?: number }) {
  const line = cardLine(shown, facts);
  return line ? (
    <div className="sess-line" style={{ paddingLeft: indent ?? cardIndent(depth) }} data-card-line>
      {line}
    </div>
  ) : null;
}
