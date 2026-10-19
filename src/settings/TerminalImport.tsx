// TERM-099 / TERM-100 (T-307): Settings > Terminal > "Bring in from Ghostty or Warp". Looks in the
// two apps' own folders, shows what it found and what it cannot use, and saves only when asked.
import { useState } from "react";
import { applyAppearance, readAppearance } from "../theme";
import { planImport, planSummary, type GhosttyImport, type WarpScan } from "./importSchemes";
import { ghosttyPatch, hasChanges, readGhostty, readWarp } from "./terminalImportRead";

type Props = { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => Promise<unknown> };

/** Saves a patch and shows it on the open window now (colours, fonts and dividers). */
const applyNow = (settings: Record<string, unknown>, patch: Record<string, unknown>) => applyAppearance(readAppearance({ ...settings, ...patch }));

function GhosttyImportBox({ settings, save }: Props) {
  const [found, setFound] = useState<GhosttyImport | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const look = async () => {
    setBusy(true);
    setResult("");
    try {
      setFound((await readGhostty()) ?? "none");
    } catch {
      setFound(null);
      setResult("Could not look for a Ghostty configuration.");
    } finally {
      setBusy(false);
    }
  };
  const apply = (r: GhosttyImport) => {
    const { patch, plan } = ghosttyPatch(readAppearance(settings).custom, r);
    applyNow(settings, patch);
    void save(patch);
    const done = [r.applied.length && `Set ${r.applied.join(", ")}.`, (plan.added.length || plan.replaced.length || plan.refused.length) && planSummary(plan)].filter(Boolean).join(" ");
    setResult(done || "Nothing changed.");
    setFound(null);
  };
  const r = found && found !== "none" ? found : null;
  return (
    <div className="scheme-import" data-section="ghostty-import">
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Looking…" : "Look for my Ghostty settings"}
        </button>
      </div>
      <p className="conn-detail">Reads your Ghostty configuration and the theme it names. Nothing changes until you bring it in.</p>
      {found === "none" && <p className="conn-detail">No Ghostty configuration was found on this computer.</p>}
      {r && (
        <div role="group" aria-label="Ghostty settings to bring in">
          {r.applied.length > 0 && <p className="conn-detail">Will set: {r.applied.join(", ")}.</p>}
          {r.schemes.length > 0 && <p className="conn-detail">Will add the colour scheme{r.schemes.length > 1 ? "s" : ""} {r.schemes.map((s) => s.name).join(" and ")}.</p>}
          {r.notes.map((n) => (
            <p key={n} className="conn-detail">{n}</p>
          ))}
          {r.unsupported.length > 0 && <p className="conn-detail">Left out, because Kolux has no such setting yet: {r.unsupported.join(", ")}.</p>}
          {r.invalid.map((i, k) => (
            <p key={k} className="conn-detail warn">
              Left out: {i.key}{i.value ? ` = ${i.value}` : ""} ({i.reason}).
            </p>
          ))}
          {r.skipped.map((s) => (
            <p key={s.file} className="conn-detail warn">
              {s.file} {s.reason}.
            </p>
          ))}
          {!hasChanges(r) && <p className="conn-detail">There is nothing in it to bring in.</p>}
          <div className="btn-row">
            <button type="button" className="btn" disabled={!hasChanges(r)} onClick={() => apply(r)}>
              Bring in
            </button>
            <button type="button" className="btn" onClick={() => setFound(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="conn-detail">{result}</p>}
    </div>
  );
}

function WarpImportBox({ settings, save }: Props) {
  const [scan, setScan] = useState<WarpScan | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const look = async () => {
    setBusy(true);
    setResult("");
    try {
      setScan(await readWarp());
      setTicked(new Set());
    } catch {
      setScan(null);
      setResult("Could not look for Warp themes.");
    } finally {
      setBusy(false);
    }
  };
  const apply = (s: WarpScan) => {
    const saved = readAppearance(settings).custom;
    const picked = s.themes.filter((t) => ticked.has(t.file)).map((t) => t.scheme);
    const plan = planImport(saved, picked);
    if (plan.added.length || plan.replaced.length) {
      const patch = { terminalCustomSchemes: plan.custom };
      applyNow(settings, patch);
      void save(patch);
    }
    setResult(planSummary(plan));
    setScan(null);
  };
  return (
    <div className="scheme-import" data-section="warp-import">
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy ? "Looking…" : "Look for my Warp themes"}
        </button>
      </div>
      <p className="conn-detail">Reads the theme files in Warp's theme folders. Pick the ones to add to your custom colour schemes.</p>
      {scan && scan.themes.length === 0 && scan.skipped.length === 0 && <p className="conn-detail">No Warp themes were found on this computer.</p>}
      {scan && (scan.themes.length > 0 || scan.skipped.length > 0) && (
        <div role="group" aria-label="Warp themes to bring in">
          {scan.themes.length > 1 && (
            <label className="conn-switch">
              <input type="checkbox" aria-label="Select all" checked={ticked.size === scan.themes.length} onChange={(e) => setTicked(e.target.checked ? new Set(scan.themes.map((t) => t.file)) : new Set())} />
              <span>Select all</span>
            </label>
          )}
          {scan.themes.map((t) => (
            <label key={t.file} className="conn-switch scheme-incoming">
              <input
                type="checkbox"
                aria-label={`Bring in ${t.scheme.name}`}
                checked={ticked.has(t.file)}
                onChange={(e) => setTicked((c) => (e.target.checked ? new Set(c).add(t.file) : new Set([...c].filter((f) => f !== t.file))))}
              />
              <span className="scheme-swatch" style={{ background: t.scheme.background, color: t.scheme.foreground }}>
                Aa
                {(["red", "green", "yellow", "blue"] as const).map((k) => (
                  <i key={k} style={{ background: t.scheme[k] }} />
                ))}
              </span>
              <span>
                {t.scheme.name}
                <small>{t.left.length > 0 ? `Skipped: ${t.left.join(", ")}.` : t.file}</small>
              </span>
            </label>
          ))}
          {scan.skipped.map((s) => (
            <p key={s.file} className="conn-detail warn">
              {s.file}: {s.reason}
            </p>
          ))}
          <div className="btn-row">
            <button type="button" className="btn" disabled={ticked.size === 0} onClick={() => apply(scan)}>
              Bring in {ticked.size || ""}
            </button>
            <button type="button" className="btn" onClick={() => setScan(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="conn-detail">{result}</p>}
    </div>
  );
}

export default function TerminalImport(props: Props) {
  return (
    <section className="conn-card" data-section="terminal-import">
      <h2 className="conn-name">Bring in from Ghostty or Warp</h2>
      <GhosttyImportBox {...props} />
      <WarpImportBox {...props} />
    </section>
  );
}
