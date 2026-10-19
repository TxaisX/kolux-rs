// T-335: the picture that stands for an agent or tool. A vendor in the registry draws its public
// brand-kit mark (in the colour set that suits the surface); any other id draws Kolux's own neutral
// glyph with the name as its text alternative. Nothing is fetched at run time.
import { Spark } from "../chrome/icons";
import { vendorMark, vendorUrl } from "./registry";
import "./marks.css";

export default function AgentMark({ id, size = 13, label }: { id: string; size?: number; label?: string }) {
  const m = vendorMark(id);
  const light = m ? vendorUrl(m.light) : undefined;
  const dark = m ? vendorUrl(m.dark) : undefined;
  if (!m || !light || !dark) return <Spark size={size} role="img" aria-label={label ?? id} />;
  if (m.light === m.dark) return <img className="vmark" src={light} width={size} height={size} alt={m.name} draggable={false} />;
  return (
    <>
      <img className="vmark vmark-light" src={light} width={size} height={size} alt={m.name} draggable={false} />
      <img className="vmark vmark-dark" src={dark} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
    </>
  );
}
