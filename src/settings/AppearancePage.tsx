// Settings > Appearance: the colour theme row (SET-001), its tint / saturation / depth sliders
// (SET-002) and the terminal colours picker with "Match app theme" (SET-003). Every change shows at
// once on the whole window; the save follows a moment later so a slider drag is one write.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyAppearance, buildTheme, isDark, MODES, previewOf, readAppearance, SPAN, swatch, themeLabel, themeVars, THEMES, uiFont, monoFont, writeAppearance, type Appearance, type Mode } from "../theme";
import { importScheme } from "../terminal/schemes";
import { schemeOptions, SchemeList } from "./SchemePicker";
import { useSettings } from "./useSettings";
import { fontStack, loadFonts, rankFonts } from "./fonts";
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

/** SET-016: a foldable section of the Appearance page; folded, its header sums up what it holds. */
function Fold({ id, title, summary, open, onToggle, children }: { id: string; title: string; summary: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className="look-fold" data-fold={id} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        <span className="look-fold-title">{title}</span>
        {!open && <span className="look-fold-sum">{summary}</span>}
      </summary>
      {children}
    </details>
  );
}

/** SET-018: a font family field; suggestions come from the installed fonts, the whole list when the
 *  field is entered and the best matches once the user types. Applies on pick, Enter or leaving. */
function FontField({ label, value, placeholder, onPick }: { label: string; value: string; placeholder: string; onPick: (family: string) => void }) {
  const [text, setText] = useState(value);
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  useEffect(() => setText(value), [value]);
  const shown = fonts ? rankFonts(fonts, typed ? text : "") : [];
  const commit = (f: string) => {
    setText(f);
    setOpen(false);
    if (f.trim() !== value) onPick(f.trim());
  };
  return (
    <label className="font-field">
      <span>{label}</span>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        maxLength={100}
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        style={{ fontFamily: fontStack(text, "var(--ui-font)") }}
        onFocus={() => {
          setTyped(false);
          setOpen(true);
          void loadFonts().then(setFonts);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(text);
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => commit(text)}
      />
      {open && shown.length > 0 && (
        <div className="font-list" role="listbox" aria-label={`${label} suggestions`}>
          {shown.map((f) => (
            <button key={f} type="button" role="option" aria-selected={f === value} tabIndex={-1} style={{ fontFamily: fontStack(f, "var(--ui-font)") }} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

const firstFamily = (stack: string) => stack.split(",")[0].replace(/"/g, "").trim();

/** `windowPart` and `windowSummary` fill the Window & Sidebar section (they live in other settings). */
export function AppearanceView({ look, onChange, windowPart, windowSummary = "" }: { look: Appearance; onChange: (a: Appearance) => void; windowPart?: ReactNode; windowSummary?: string }) {
  const classic = look.theme === "classic";
  // All three sections open at first; a link into a folded one unfolds it (SettingsPage).
  const [open, setOpen] = useState({ interface: true, terminal: true, window: true });
  const fold = (k: keyof typeof open) => ({ open: open[k], onToggle: (o: boolean) => setOpen((p) => (p[k] === o ? p : { ...p, [k]: o })) });
  const name = (id: string) => schemeOptions(look, true).find((o) => o.id === id)?.name ?? id;
  return (
    <>
      <Fold id="interface" title="Interface" summary={[MODE_LABEL[look.mode], themeLabel(look.theme), look.appFont || "Default font"].join(" · ")} {...fold("interface")}>
      <section className="conn-card" data-section="interface">
        <h2 className="conn-name">Mode</h2>
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
      <section className="conn-card" data-section="fonts">
        <h2 className="conn-name">Fonts</h2>
        <FontField label="App font" value={look.appFont} placeholder={`Default (${firstFamily(uiFont)})`} onPick={(appFont) => onChange({ ...look, appFont })} />
        <FontField label="Editor font" value={look.editorFont} placeholder="Same as the terminal font" onPick={(editorFont) => onChange({ ...look, editorFont })} />
        <p className="conn-detail">Leave a field empty for the default. A font that is not installed falls back to the default, so text always shows.</p>
      </section>
      </Fold>
      <Fold id="terminal" title="Terminal" summary={[firstFamily(monoFont), look.lightTerminal ? `${name(look.terminal)} / ${name(look.lightScheme)}` : name(look.terminal)].join(" · ")} {...fold("terminal")}>
      <section className="conn-card" data-section="terminal-colours">
        <h2 className="conn-name">Terminal colours</h2>
        <TerminalColours look={look} onChange={onChange} />
      </section>
      </Fold>
      <Fold id="window" title="Window & Sidebar" summary={windowSummary} {...fold("window")}>
        {windowPart}
      </Fold>
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
function StatusBarSwitch({ settings, error, save }: ReturnType<typeof useSettings>) {
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
  const status = useSettings();
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
      {look && <AppearanceView look={look} onChange={change} windowPart={<StatusBarSwitch {...status} />} windowSummary={status.settings && !readStatusBar(status.settings).visible ? "Status bar hidden" : "Status bar shown"} />}
    </>
  );
}
