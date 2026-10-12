// A context ring (USAGE-003): a track and an arc that fills with the percentage, coloured by
// the same 70/90 scale as the card bar. It never prints the number; the title carries the words.
import { tone } from "./meter";

export default function Ring({ percent, size = 14, title }: { percent: number; size?: number; title?: string }) {
  const r = size / 2 - 1.5;
  const round = 2 * Math.PI * r;
  const t = tone(percent);
  return (
    <svg className={t ? `ring ${t}` : "ring"} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gauge-track)" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${(Math.round(percent) / 100) * round} ${round}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}
