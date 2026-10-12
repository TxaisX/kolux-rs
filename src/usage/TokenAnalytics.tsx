// USAGE-012 / USAGE-013: usage analytics on Settings > Usage. A provider picker (Overview, Claude,
// Codex); only the panel picked is drawn and scanned. Saved figures show at once, a rescan follows
// for the tracked providers shown, and tracking is opt-in for each provider.
// ponytail: range, scope, cost by model, the daily chart and recent sessions are T-137-a; Grok's
// credits panel is T-137-b; the activity counts above the analytics are T-136-c.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Segmented } from "../settings/GeneralPage";
import { locale } from "../language";
import { estimate } from "./pricing";
import { grid, NAMES, overview, panelState, rowsOf, shownProviders, type Pick, type Provider, type Saved, type Usage } from "./tokens";

const PICKS: Array<{ id: Pick; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];
const LOGS: Record<Provider, string> = { claude: "Claude Code", codex: "Codex" };
const WEEKS = 26;

const count = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (usd: number, partial: boolean) => (partial && usd === 0 ? "n/a" : new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }).format(usd));
const share = (x: number) => new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 1 }).format(x);
const dayText = (day: string) => new Date(day + "T12:00:00").toLocaleDateString(locale(), { dateStyle: "medium" });

type ViewProps = {
  usage: Usage;
  pick: Pick;
  scanning: string[];
  today: Date;
  onPick: (p: Pick) => void;
  onTrack: (p: Provider, on: boolean) => void;
  onRefresh: () => void;
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ta-stat">
      <span className="ta-stat-label">{label}</span>
      <span className="ta-stat-value">{value}</span>
      {note && <span className="ta-stat-note">{note}</span>}
    </div>
  );
}

function Failed({ usage, providers }: { usage: Usage; providers: Provider[] }) {
  return (
    <>
      {providers.map((p) => {
        const s = usage[p];
        return s?.error && s.rows.length > 0 ? (
          <p key={p} className="conn-detail warn" role="status">
            Could not read {LOGS[p]}'s logs just now ({s.error}); these are the last figures.
          </p>
        ) : null;
      })}
    </>
  );
}

const WHY = "Kolux reads only the logs these agents already keep on this computer; nothing is sent anywhere.";

function OverviewPanel({ usage, today, onTrack }: { usage: Usage; today: Date; onTrack: ViewProps["onTrack"] }) {
  const state = panelState(usage, "overview");
  if (state === "off")
    return (
      <section className="conn-card" data-panel="overview">
        <h2 className="conn-name">Token tracking is off</h2>
        <p className="conn-detail">See how many tokens your agents used and what that would cost. {WHY}</p>
        <div className="btn-row">
          {(["claude", "codex"] as Provider[]).map((p) => (
            <button key={p} className="btn" onClick={() => onTrack(p, true)}>
              {`Enable ${NAMES[p]}`}
            </button>
          ))}
        </div>
      </section>
    );
  const shown = shownProviders(usage, "overview");
  if (state === "empty")
    return (
      <section className="conn-card" data-panel="overview">
        <h2 className="conn-name">No figures yet</h2>
        <p className="conn-detail">Tracking is on for {shown.map((p) => NAMES[p]).join(" and ")}. Figures arrive after the next agent session.</p>
      </section>
    );
  const o = overview(Object.fromEntries(shown.map((p) => [p, rowsOf(usage, p)])));
  const cols = grid(o.days, today, WEEKS, o.best?.day);
  const mixTotal = o.tokens || 1;
  const mix: Array<[keyof typeof o.mix, string]> = [
    ["fresh", "Fresh input"],
    ["cache", "Cache"],
    ["output", "Output"],
    ["reasoning", "Reasoning"],
  ];
  return (
    <section className="conn-card ta-card" data-panel="overview">
      <div className="ta-stats">
        <Stat label="Total tokens" value={count(o.tokens)} />
        <Stat label="Estimated cost" value={money(o.usd, o.partial)} note={o.partial ? "partial: some models have no known price" : undefined} />
        <Stat label="Active days" value={String(o.activeDays)} />
        <Stat label="From cache" value={share(o.cacheShare)} />
      </div>
      <div className="ta-grid-wrap">
        <div className="ta-grid" data-activity-grid role="img" aria-label={`Tokens per day for the last ${WEEKS} weeks`}>
          {cols.map((col, i) => (
            <div key={i} className="ta-col">
              {col.map((c) => (
                <span key={c.day} className={`ta-cell l${c.level}${c.best ? " best" : ""}${c.future ? " future" : ""}`} title={c.future ? undefined : `${dayText(c.day)}: ${count(c.tokens)} tokens`} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {o.best && (
        <p className="conn-detail">
          Best day: {dayText(o.best.day)}, {count(o.best.tokens)} tokens
        </p>
      )}
      <div className="ta-mix" aria-label="Token mix">
        {mix.map(([k]) => (o.mix[k] > 0 ? <span key={k} className={`ta-mix-part ${k}`} style={{ flexGrow: o.mix[k] / mixTotal }} /> : null))}
      </div>
      <div className="ta-legend">
        {mix.map(([k, label]) => (
          <span key={k}>
            <i className={`ta-swatch ${k}`} />
            {label} {count(o.mix[k])}
          </span>
        ))}
      </div>
      <p className="conn-detail">
        {o.providers === 1 ? "1 provider" : `${o.providers} providers`} contributing
      </p>
      <Failed usage={usage} providers={shown} />
    </section>
  );
}

function ProviderPanel({ usage, p, onTrack }: { usage: Usage; p: Provider; onTrack: ViewProps["onTrack"] }) {
  const on = usage.tracking[p];
  const state = panelState(usage, p);
  const rows = rowsOf(usage, p);
  const sum = (k: "input" | "output" | "cacheRead" | "cacheWrite") => rows.reduce((t, r) => t + r[k], 0);
  const cost = estimate(p, rows);
  return (
    <section className="conn-card ta-card" data-panel={p}>
      <header className="conn-head">
        <h2 className="conn-name">{NAMES[p]} tokens</h2>
        <label className="conn-switch ta-switch">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onTrack(p, e.target.checked)} />
          Track
        </label>
      </header>
      {state === "off" && <p className="conn-detail">Turn this on to see {NAMES[p]}'s token use on this computer. {WHY}</p>}
      {state === "empty" && <p className="conn-detail">No {LOGS[p]} logs on this computer yet. Figures arrive after the next {NAMES[p]} session.</p>}
      {state === "figures" && (
        <>
          <div className="ta-stats">
            <Stat label="Input" value={count(sum("input"))} />
            <Stat label="Output" value={count(sum("output"))} />
            <Stat label="Cache reads" value={count(sum("cacheRead"))} />
            <Stat label="Cache writes" value={count(sum("cacheWrite"))} />
            <Stat label="Estimated cost" value={money(cost.usd, cost.unpriced.length > 0)} note={cost.unpriced.length ? "partial: some models have no known price" : undefined} />
          </div>
          <Failed usage={usage} providers={[p]} />
        </>
      )}
    </section>
  );
}

export function TokenAnalyticsView({ usage, pick, scanning, today, onPick, onTrack, onRefresh }: ViewProps) {
  const shown = shownProviders(usage, pick);
  const busy = shown.some((p) => scanning.includes(p));
  return (
    <div className="ta">
      <div className="ta-head">
        <Segmented label="Usage analytics" options={PICKS} value={pick} onPick={onPick} />
        <button className="btn" disabled={busy || shown.length === 0} onClick={onRefresh}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {pick === "overview" ? <OverviewPanel usage={usage} today={today} onTrack={onTrack} /> : <ProviderPanel usage={usage} p={pick} onTrack={onTrack} />}
    </div>
  );
}

export default function TokenAnalytics() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [pick, setPick] = useState<Pick>("overview");
  const [scanning, setScanning] = useState<Provider[]>([]);
  const scanned = useRef(new Set<Provider>());

  const scan = useCallback((ps: Provider[]) => {
    for (const p of ps) {
      scanned.current.add(p);
      setScanning((s) => [...s, p]);
      invoke<Saved>("token_usage_scan", { provider: p })
        .then((saved) => setUsage((u) => (u ? { ...u, [p]: saved } : u)))
        .catch(() => {})
        .finally(() => setScanning((s) => s.filter((x) => x !== p)));
    }
  }, []);

  useEffect(() => {
    invoke<Usage>("token_usage").then(setUsage, () => {});
  }, []);
  // Saved figures are drawn first; each tracked provider the picked panel shows is rescanned once.
  useEffect(() => {
    if (usage) scan(shownProviders(usage, pick).filter((p) => !scanned.current.has(p)));
  }, [usage, pick, scan]);

  const track = (p: Provider, on: boolean) => {
    invoke("token_tracking_set", { provider: p, on })
      .then(() => {
        setUsage((u) => (u ? { ...u, tracking: { ...u.tracking, [p]: on } } : u));
        if (on) scanned.current.delete(p);
      })
      .catch(() => {});
  };

  if (!usage) return null;
  return <TokenAnalyticsView usage={usage} pick={pick} scanning={scanning} today={new Date()} onPick={setPick} onTrack={track} onRefresh={() => scan(shownProviders(usage, pick).filter((p) => !scanning.includes(p)))} />;
}
