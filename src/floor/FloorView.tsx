// VIEW-013: the Floor page. One lane per agent pane with coloured segments for working, needs-you
// and idle over the chosen range, and six time ticks along the axis.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { lanes, RANGES, rangeStart, ticks, type Kind, type Range, type Track } from "./timeline";

const COLOUR: Record<Kind, string> = { working: "var(--working)", needs: "var(--warn)", idle: "var(--line-strong)", unverifiable: "var(--line-subtle)" };
const WORD: Record<Kind, string> = { working: "Working", needs: "Needs you", idle: "Idle", unverifiable: "Unverifiable" };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Props = { initial?: Track[]; now?: number; load?: () => Promise<Track[]> };

export default function FloorView({ initial, now: fixed, load = () => invoke<Track[]>("activity_timeline") }: Props) {
  const [range, setRange] = useState<Range>("60m");
  const [tracks, setTracks] = useState<Track[]>(initial ?? []);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(fixed ?? Date.now());
  useEffect(() => {
    if (initial) return;
    const tick = () =>
      load().then(
        (t) => {
          setTracks(t);
          setError(null);
          setNow(Date.now());
        },
        (e) => setError(String(e)),
      );
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, []);
  const from = rangeStart(range, now);
  const shown = lanes(tracks, from, now);
  const pct = (ms: number) => `${(ms / (now - from)) * 100}%`;
  return (
    <section className="floor" aria-label="Floor" style={{ padding: "16px 20px", color: "var(--fg)", overflow: "auto", height: "100%" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, flex: 1 }}>Floor</h2>
        {RANGES.map((r) => (
          <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} style={{ fontWeight: range === r.id ? 600 : 400 }}>
            {r.label}
          </button>
        ))}
      </header>
      <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--fg-muted)", marginBottom: 8 }}>
        {(Object.keys(WORD) as Kind[]).map((k) => (
          <span key={k}>
            <span style={{ display: "inline-block", width: 10, height: 10, background: COLOUR[k], marginRight: 4, borderRadius: 2 }} />
            {WORD[k]}
          </span>
        ))}
      </div>
      {error && <p className="muted">The Floor could not be read: {error}</p>}
      {!error && shown.length === 0 && <p className="muted">No agent reported any activity in this range.</p>}
      {shown.map(({ track, segs, depth }) => (
        <div key={track.pane} className="floor-lane" data-depth={depth} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 110, boxSizing: "border-box", paddingLeft: depth * 14, flexShrink: 0, fontSize: 12 }}>
            {depth > 0 ? "↳ " : ""}
            {track.terminal === null ? `Pane ${track.pane}` : `Terminal ${track.terminal}`}
            {track.live ? "" : " (closed)"}
          </span>
          <div style={{ position: "relative", flex: 1, height: 14, background: "var(--chip-bg)", borderRadius: 3 }}>
            {segs.map((s) => (
              <span key={s.from} className={`floor-seg floor-${s.kind}`} title={`${WORD[s.kind]} ${clock(s.from)} to ${clock(s.to)}`} data-ms={s.to - s.from} style={{ position: "absolute", top: 0, bottom: 0, left: pct(s.from - from), width: pct(s.to - s.from), background: COLOUR[s.kind], borderRadius: 2 }} />
            ))}
          </div>
        </div>
      ))}
      <div className="floor-axis" style={{ position: "relative", marginLeft: 118, height: 18, fontSize: 11, color: "var(--fg-faint)" }}>
        {ticks(from, now).map((t, i) => (
          <span key={i} className="floor-tick" style={{ position: "absolute", left: pct(t - from), transform: i === 0 ? "none" : i === 5 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </section>
  );
}
