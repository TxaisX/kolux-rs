// Settings > General: the Classic or New look and the screen that opens first (SET-037).
import { screens } from "../chrome/TopBar";
import { useSettings } from "./useSettings";
import { FIRST_FIELD, LOOK_FIELD, NEEDS_STRIP_FIELD, readLook, savedFirst, stripOn, type Look } from "./general";
import { REVIEW_FIELD, reviewOn } from "../editor/notes";

/** A row of buttons that behaves as one radio group. */
export function Segmented<T extends string>({ label, options, value, onPick, off = [] }: { label: string; options: Array<{ id: T; label: string }>; value: T; onPick: (v: T) => void; off?: T[] }) {
  return (
    <div className="seg-row" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} disabled={off.includes(o.id)} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GeneralView({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const look = readLook(settings);
  const classic = look === "classic";
  return (
    <section className="conn-card" data-section="views">
      <h2 className="conn-name">Look and first screen</h2>
      <div className="look-select">
        <span>Look</span>
        <Segmented<Look> label="Look" options={[{ id: "classic", label: "Classic" }, { id: "new", label: "New" }]} value={look} onPick={(v) => onSave({ [LOOK_FIELD]: v })} />
      </div>
      <p className="conn-detail">New shows the redesigned screens with Agents, Board and Terminals in the top bar; Classic keeps the earlier layout.</p>
      <div className="look-select">
        <span>Opens first</span>
        <Segmented label="Opens first" options={screens} value={classic ? "terminals" : savedFirst(settings)} off={classic ? ["agents", "board"] : []} onPick={(v) => onSave({ [FIRST_FIELD]: v })} />
      </div>
      {classic && <p className="conn-detail">Switch the look to New to open on Agents or Board.</p>}
      <label className="conn-switch">
        <input type="checkbox" aria-label="Review notes" checked={reviewOn(settings)} onChange={(e) => onSave({ [REVIEW_FIELD]: e.target.checked })} />
        <span>Review notes: select text in a file and press Ctrl+Shift+A to add a note for an agent.</span>
      </label>
      <label className="conn-switch">
        <input type="checkbox" aria-label="Needs you strip" checked={stripOn(settings)} onChange={(e) => onSave({ [NEEDS_STRIP_FIELD]: e.target.checked })} />
        <span>Needs you strip: a row above the grid lists the sessions waiting on a permission or a question.</span>
      </label>
    </section>
  );
}

export default function GeneralPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GeneralView settings={settings} onSave={save} />}
    </>
  );
}
