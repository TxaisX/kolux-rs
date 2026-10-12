// Settings > Appearance: the colour theme row (SET-001), its tint / saturation / depth sliders
// (SET-002) and the terminal colours picker with "Match app theme" (SET-003). Every change shows at
// once on the whole window; the save follows a moment later so a slider drag is one write.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyAppearance, buildTheme, isDark, MODES, previewOf, readAppearance, SPAN, swatch, themeLabel, themeVars, THEMES, writeAppearance, type Appearance, type Mode } from "../theme";
import { importScheme } from "../terminal/schemes";
import { schemeOptions, SchemeList } from "./SchemePicker";
import { useSettings } from "./useSettings";
import { FIELDS as STATUS_FIELDS, readStatusBar } from "../chrome/statusItems";
import { Segmented } from "./GeneralPage";

const MODE_LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

const SLIDERS = [
  { key: "tint", label: "Tint", unit: "°" },
  { key: "saturation", label: "Saturation", unit: " %" },
  { key: "depth", label: "Depth", unit: "" },
] as const;

/** A small window drawn in the given look, beside the swatches. */
export function ThemePreview({ look }: { look: Appearance }) {
  return (
    <div className="look-preview" style={themeVars(buildTheme(previewOf(look), isDark(look))) as CSSProperties} aria-label={`Preview: ${themeLabel(previewOf(look).theme)}`}>
      <div className="lp-top" />
      <div className="lp-body">
        <div className="lp-side">
          <span className="lp-row sel" />
          <span className="lp-row" />
          <span className="lp-row" />
        </div>
        <div className="lp-pane">
          <span className="lp-line" />
          <span className="lp-line short" />
        </div>
      </div>
    </div>
  );
}

export function AppearanceView({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const classic = look.theme === "classic";
  return (
    <>
      <section className="conn-card" data-section="interface">
        <h2 className="conn-name">Interface</h2>
        <div className="look-select">
          <span>Mode</span>
          <Segmented<Mode> label="Mode" options={MODES.map((m) => ({ id: m, label: MODE_LABEL[m] }))} value={look.mode} onPick={(mode) => onChange({ ...look, mode })} />
        </div>
        {look.mode === "system" && <p className="conn-detail">Follows Windows, also while Kolux is running.</p>}
      </section>
      <section className="conn-card" data-section="theme">
        <h2 className="conn-name">Colour theme</h2>
        <div className="look-row">
          <div className="look-swatches" role="radiogroup" aria-label="Colour theme">
            {THEMES.map((t) => (
              <button key={t} role="radio" aria-checked={look.theme === t} title={themeLabel(t)} aria-label={themeLabel(t)} className={look.theme === t ? "look-swatch on" : "look-swatch"} style={{ background: swatch(t) }} onClick={() => onChange({ ...look, theme: t })} />
            ))}
            <div className="look-name">{themeLabel(look.theme)}</div>
          </div>
          <ThemePreview look={look} />
        </div>
        {SLIDERS.map(({ key, label, unit }) => (
          <label key={key} className={classic ? "look-slider off" : "look-slider"}>
            <span>{label}</span>
            <input type="range" min={SPAN[key][0]} max={SPAN[key][1]} step={1} value={look[key]} disabled={classic} onChange={(e) => onChange({ ...look, [key]: Number(e.target.value) })} />
            <output>
              {look[key]}
              {unit}
            </output>
          </label>
        ))}
        {classic && <p className="conn-detail">Classic keeps the original neutral look; pick a colour to use the sliders.</p>}
      </section>
      <section className="conn-card" data-section="terminal-colours">
        <h2 className="conn-name">Terminal colours</h2>
        <TerminalColours look={look} onChange={onChange} />
      </section>
    </>
  );
}

/** SET-023: a scheme for dark mode and one for light mode, a search box over both, and schemes
 *  pasted in Windows Terminal's JSON format. Removing a scheme in use falls back to the default. */
function TerminalColours({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState("");
  const add = () => {
    try {
      const s = importScheme(paste);
      if (look.custom.some((c) => c.name.toLowerCase() === s.name.toLowerCase())) throw new Error(`You already have a scheme called ${s.name}.`);
      onChange({ ...look, custom: [...look.custom, s] });
      setPaste("");
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = (id: string) => {
    const custom = look.custom.filter((c) => "custom:" + c.name !== id);
    const tidy = readAppearance(writeAppearance({}, { ...look, custom }));
    onChange(tidy);
  };
  return (
    <>
      <input className="scheme-search" type="search" maxLength={80} placeholder="Search schemes" aria-label="Search schemes" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="scheme-cols">
        <SchemeList label="Dark mode" options={schemeOptions(look, true)} query={query} value={look.terminal} onPick={(terminal) => onChange({ ...look, terminal })} onRemove={remove} />
        <SchemeList label="Light mode" options={schemeOptions(look, false)} query={query} value={look.lightScheme} disabled={!look.lightTerminal} onPick={(lightScheme) => onChange({ ...look, lightScheme })} onRemove={remove} />
      </div>
      <p className="conn-detail">Match app theme works the terminal background, text and colours out of the app's colour, and follows it as it changes.</p>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={look.lightTerminal} onChange={(e) => onChange({ ...look, lightTerminal: e.target.checked })} />
        <span>
          Light scheme in light mode
          <small>Terminals turn light with the app. Off keeps the dark mode scheme in both modes.</small>
        </span>
      </label>
      <label className="scheme-add">
        <span>Add a scheme</span>
        <textarea rows={3} placeholder='Paste a Windows Terminal scheme, e.g. { "name": "Mine", "background": "#101010", ... }' value={paste} onChange={(e) => setPaste(e.target.value)} />
      </label>
      <button type="button" className="menu-item scheme-add-btn" disabled={!paste.trim()} onClick={add}>
        Add scheme
      </button>
      {problem && <p className="conn-detail warn">{problem}</p>}
    </>
  );
}

/** VIEW-096: the status bar hidden from its right-click menu comes back here. */
function StatusBarSwitch() {
  const { settings, error, save } = useSettings();
  if (!settings) return null;
  return (
    <section className="conn-card" data-section="status-bar">
      <h2 className="conn-name">Status bar</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={readStatusBar(settings).visible} onChange={(e) => void save({ [STATUS_FIELDS.visible]: e.target.checked })} />
        <span>
          Show status bar
          <small>Right-click the bar to choose which items it shows.</small>
        </span>
      </label>
      {error && <p className="conn-detail warn">{error}</p>}
    </section>
  );
}

export default function AppearancePage() {
  const [look, setLook] = useState<Appearance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => setLook(readAppearance(s)))
      .catch((e) => setError(String(e)));
    return () => window.clearTimeout(timer.current);
  }, []);
  const change = (next: Appearance) => {
    setLook(next);
    applyAppearance(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      invoke<Record<string, unknown>>("get_settings")
        .then((s) => invoke("save_settings", { value: writeAppearance(s, next) }))
        .catch((e) => setError(String(e)));
    }, 250);
  };
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {look && <AppearanceView look={look} onChange={change} />}
      {look && <StatusBarSwitch />}
    </>
  );
}
