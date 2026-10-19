// The second line of a workspace card in the sidebar (PROJ-062): the shown details' words, muted,
// under the name. Nothing is drawn when the preset shows nothing or there is nothing to say.
import { cardLine, type CardFacts } from "./cards";

export default function CardLine({ shown, facts, indent }: { shown: readonly string[]; facts: CardFacts; indent: number }) {
  const line = cardLine(shown, facts);
  return line ? (
    <div className="sess-line" style={{ paddingLeft: indent }} data-card-line>
      {line}
    </div>
  ) : null;
}
