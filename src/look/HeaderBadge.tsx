import { PALETTE, type HeaderColour } from "./headerColour";

/** The coloured badge at the start of a project or group header. */
export function HeaderBadge({ colour }: { colour: HeaderColour }) {
  return <span className="hdr-badge" role="img" aria-label={`${colour.label} header`} style={{ background: colour.hex }} />;
}

/** The palette, as a row of round swatches inside a project or group form. */
export function HeaderSwatches({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <div className="hdr-swatches" role="radiogroup" aria-label="header colour">
      {PALETTE.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={c.id === value} aria-label={c.label} title={c.label} className={`hdr-swatch${c.id === value ? " on" : ""}`} style={{ background: c.hex }} onClick={() => onPick(c.id)} />
      ))}
    </div>
  );
}
