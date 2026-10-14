// ONB-001..005: the first-run wizard, a four-screen card floating over the dimmed app. WizardView is
// pure; Wizard holds the screen, the Ctrl+Enter chord and the stored progress (onboarding.rs), and
// hands every real action (samples, kits, a session, Add Project) to App through its props.
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import Ask from "../chrome/Ask";
import { Close, Mark } from "../chrome/icons";
import { KITS, type Vendor } from "../kits/catalog";
import { KitCard, KitIcon } from "../kits/Kits";
import { ConnectGrid } from "../settings/ConnectGrid";
import { ClaudeCard } from "../settings/SettingsPage";
import CodexCard from "../settings/CodexCard";
import GrokCard from "../settings/GrokCard";
import { chordFires, leaveKey, milestone, SCREENS } from "./firstRun";

const TILES = [
  { ai: "Claude", doing: "Writing up the findings" },
  { ai: "Codex", doing: "Building the report" },
  { ai: "Grok", doing: "Checking the numbers" },
];
/** ONB-004: only kits whose every needed input comes with sample data are offered as samples. */
const SAMPLES = KITS.filter((k) => k.inputs.every((i) => !i.required || i.sample !== undefined));

type ViewProps = {
  at: number;
  /** Some AI counts as connected (ONB-003). */
  connected: boolean;
  sample: string;
  busy: boolean;
  kit: string;
  ping: boolean;
  vendors: Vendor[];
  error: string | null;
  cards?: ReactNode;
  /** ONB-001: hidden, keeping its place, while a kit dialog is open. */
  hidden?: boolean;
  onSample: (id: string) => void;
  onKit: (id: string) => void;
  onPing: (on: boolean) => void;
  onBack: () => void;
  onMain: () => void;
  onSecondary: () => void;
  onPickFolder: () => void;
  onClose?: () => void;
  /** ONB-006: the leave question is showing. */
  leaving?: boolean;
  /** ONB-006: a primary click on the dimmed app around the card. */
  onOutside?: () => void;
  onSkip?: () => void;
  onStay?: () => void;
};

export const mainOff = (at: number, connected: boolean, busy: boolean) => (at === 1 && !connected) || (at === 2 && busy);

export function WizardView(p: ViewProps) {
  const screen = SCREENS[p.at];
  const main = ["Get started", "Continue", p.busy ? "Setting up…" : "Try with sample data", "Start kit"][p.at];
  const secondary = [null, "I’ll do this later", null, "Just open a session"][p.at];
  return (
    <div className="ask-backdrop onb-backdrop" hidden={p.hidden} onMouseDown={(e) => e.button === 0 && e.target === e.currentTarget && p.onOutside?.()}>
      <div className="onb-drag" data-tauri-drag-region />
      <div className="onb" role="dialog" aria-modal="true" aria-label="Get started with Kolux">
        <div className="onb-head">
          <Mark size={22} />
          <div className="onb-progress">
            {SCREENS.map((s, i) => (
              <span key={s.id} className={i === p.at ? "onb-bar now" : i < p.at ? "onb-bar done" : "onb-bar"} title={s.name} />
            ))}
          </div>
          <span className="onb-count">{`${p.at + 1} of ${SCREENS.length}`}</span>
          {p.onClose && (
            <button className="ib" title="Close" onClick={p.onClose}>
              <Close />
            </button>
          )}
        </div>
        <h2 className="onb-heading">{screen.heading}</h2>
        <p className="onb-sub">{screen.sub}</p>
        <div className="onb-body">
          {p.at === 0 && (
            <div className="onb-tiles">
              {TILES.map((t) => (
                <div key={t.ai} className="onb-tile" aria-label={`${t.ai} at work`}>
                  <span className="onb-dot" />
                  <span className="onb-ai">{t.ai}</span>
                  <span className="onb-doing">{t.doing}</span>
                </div>
              ))}
            </div>
          )}
          {p.at === 1 && p.cards}
          {p.at === 2 && (
            <div className="onb-work">
              <button className="btn onb-folder" onClick={p.onPickFolder} disabled={p.busy}>
                Pick a folder
              </button>
              <div className="onb-or">or</div>
              <div className="onb-samples">
                {SAMPLES.map((k) => (
                  <button key={k.id} className="onb-sample" aria-pressed={k.id === p.sample} aria-label={k.title} onClick={() => p.onSample(k.id)} disabled={p.busy}>
                    <span className="kit-icon">
                      <KitIcon id={k.id} />
                    </span>
                    <span className="onb-sample-title">{k.title}</span>
                  </button>
                ))}
              </div>
              {p.error && <p className="onb-error" role="alert">{`Kolux could not set up the sample data: ${p.error}`}</p>}
            </div>
          )}
          {p.at === 3 && (
            <>
              <div className="kit-grid">
                {KITS.map((k) => (
                  <KitCard key={k.id} kit={k} connected={p.vendors} selected={k.id === p.kit} onPick={p.onKit} />
                ))}
              </div>
              <label className="onb-ping">
                <input type="checkbox" role="switch" checked={p.ping} onChange={(e) => p.onPing(e.target.checked)} />
                <span>Tell me whenever an AI finishes</span>
              </label>
            </>
          )}
        </div>
        <div className="onb-foot">
          {secondary && (
            <button className="btn onb-secondary" onClick={p.onSecondary}>
              {secondary}
            </button>
          )}
          <span className="onb-gap" />
          {p.at > 0 && (
            <button className="btn" onClick={p.onBack} disabled={p.busy}>
              Back
            </button>
          )}
          <button className="btn primary onb-main" disabled={mainOff(p.at, p.connected, p.busy)} onClick={p.onMain}>
            {main}
            <span className="onb-chord">{/Mac/i.test(globalThis.navigator?.platform ?? "") ? "⌘ ↵" : "Ctrl ↵"}</span>
          </button>
        </div>
      </div>
      {p.leaving && (
        <Ask
          title="Skip setup?"
          body="You can pick setup up again any time: open the help menu in the sidebar and choose Onboarding."
          confirm="Skip"
          cancel="No, keep going"
          safe
          onConfirm={() => p.onSkip?.()}
          onCancel={() => p.onStay?.()}
        />
      )}
    </div>
  );
}

type Props = {
  /** The screen to open on (firstRun.ts openAt). */
  start: number;
  /** AIs ready for kit roles (installed and on). */
  vendors: Vendor[];
  ping: boolean;
  onPing: (on: boolean) => void;
  hidden: boolean;
  /** Sets the sample up as the workspace; rejects with the reason when it could not. */
  onSample: (kit: string) => Promise<void>;
  onKit: (kit: string) => void;
  onSession: () => void;
  onPickFolder: () => void;
  /** ONB-006: Skip in the leave question; the wizard closes as dismissed. */
  onClose: () => void;
};

export default function Wizard(props: Props) {
  const [at, setAt] = useState(props.start);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [sample, setSample] = useState(SAMPLES[0]?.id ?? KITS[0].id);
  const [kit, setKit] = useState(KITS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ONB-006: Escape, a click on the dimmed app or the corner close asks first; one question at a time.
  const [leaving, setLeaving] = useState(false);
  const connected = Object.values(on).some(Boolean);
  // ONB-003 / ONB-011: the Connect cards first reporting a connected AI is the first-AI milestone.
  useEffect(() => {
    if (connected) void milestone("aiConnected");
  }, [connected]);
  const go = (to: number) => {
    // The stored step is the last screen finished (onboarding.rs); a failed save keeps the wizard going.
    if (to > at) invoke("onboarding_step", { step: to - 1 }).catch(() => {});
    setError(null);
    setAt(to);
  };
  const tryIt = () => {
    setBusy(true);
    setError(null);
    props.onSample(sample).then(
      () => {
        setKit(sample);
        setBusy(false);
        go(3);
      },
      (err) => {
        setBusy(false);
        setError(String(err));
      },
    );
  };
  const main = () => [() => go(1), () => go(2), tryIt, () => props.onKit(kit)][at]();
  const secondary = () => (at === 1 ? go(2) : at === 3 ? props.onSession() : undefined);
  const off = mainOff(at, connected, busy);
  useEffect(() => {
    if (props.hidden) return;
    const key = (e: KeyboardEvent) => {
      if (leaveKey(e)) return setLeaving(true);
      if (!chordFires(e, off || leaving)) return;
      e.preventDefault();
      main();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const [mark] = useState(() => (id: string) => (v: boolean) => setOn((o) => (o[id] === v ? o : { ...o, [id]: v })));
  const [cards] = useState(() => ({ claude: <ClaudeCard onConnected={mark("claude")} />, codex: <CodexCard onConnected={mark("codex")} />, grok: <GrokCard onConnected={mark("grok")} /> }));
  return (
    <WizardView
      at={at}
      connected={connected}
      sample={sample}
      busy={busy}
      kit={kit}
      ping={props.ping}
      vendors={props.vendors}
      error={error}
      cards={<ConnectGrid cards={cards} />}
      hidden={props.hidden}
      onSample={setSample}
      onKit={setKit}
      onPing={props.onPing}
      onBack={() => go(at - 1)}
      onMain={main}
      onSecondary={secondary}
      onPickFolder={props.onPickFolder}
      onClose={() => setLeaving(true)}
      leaving={leaving}
      onOutside={() => setLeaving(true)}
      onSkip={() => {
        setLeaving(false);
        props.onClose();
      }}
      onStay={() => setLeaving(false)}
    />
  );
}
