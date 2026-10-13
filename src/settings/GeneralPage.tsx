// Settings > General: the Classic or New look and the screen that opens first (SET-037).
import { screens } from "../chrome/TopBar";
import { useSettings } from "./useSettings";
import { FIRST_FIELD, LOOK_FIELD, readLook, savedFirst, type Look } from "./general";
import { AUTOSAVE_KEY, AUTOSAVE_PAUSE_KEY, autosaveOf, PAUSE_DEFAULT, PAUSE_MAX, PAUSE_MIN } from "../editor/autosave";

/** EDIT-002: autosave, off until switched on, and the pause after typing before it writes. */
export function EditorSettings({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const pause = autosaveOf({ ...settings, [AUTOSAVE_KEY]: true }) ?? PAUSE_DEFAULT;
  const on = autosaveOf(settings) !== null;
  const put = (seconds: number) => Number.isFinite(seconds) && onSave({ [AUTOSAVE_PAUSE_KEY]: Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, Math.round(seconds * 1000))) });
  return (
    <section className="conn-card" data-section="editor">
      <h2 className="conn-name">Editor</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onSave({ [AUTOSAVE_KEY]: e.target.checked })} />
        <span>
          Autosave
          <small>Writes an edited file a short pause after you stop typing. A file another program changed is never written over.</small>
        </span>
      </label>
      <label className="look-select">
        <span>Pause before saving (seconds)</span>
        <input key={pause} aria-label="Autosave pause in seconds" className="field" type="number" min={PAUSE_MIN / 1000} max={PAUSE_MAX / 1000} step={0.25} defaultValue={pause / 1000} disabled={!on} onBlur={(e) => put(e.currentTarget.valueAsNumber)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      </label>
    </section>
  );
}

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
    </section>
  );
}

export default function GeneralPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GeneralView settings={settings} onSave={save} />}
      {settings && <EditorSettings settings={settings} onSave={save} />}
    </>
  );
}
