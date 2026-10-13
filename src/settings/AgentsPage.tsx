// Settings > Agents (SET-027): which agents are switched on, the default one, and how each starts.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { AgentInfo } from "../launch/PlusMenu";
import { DEFAULT_AGENT_KEY, defaultAgentId, disabledAgents, switchAgent } from "../launch/agents";
import { Segmented } from "./GeneralPage";
import { useSettings } from "./useSettings";
import { CAP_FIELD, capOn } from "../usage/meter";

const OPTIONS_FIELD = "agentOptions";
const PERMISSIONS_FIELD = "agentPermissions";
type Options = { command?: string; args?: string; env?: string };
type StartLine = { args: string[]; program: string | null };

const optionsOf = (s: Record<string, unknown>, id: string): Options => ((s[OPTIONS_FIELD] as Record<string, Options> | undefined)?.[id] ?? {}) as Options;

/** A text field kept as a draft while typing and saved when it loses focus. */
function Draft({ label, value, multi, placeholder, onSave }: { label: string; value: string; multi?: boolean; placeholder: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = { "aria-label": label, className: multi ? "field multi" : "field", placeholder, value: draft, onBlur: () => draft !== value && onSave(draft) };
  return (
    <label className="agent-field">
      <span>{label}</span>
      {multi ? <textarea {...props} rows={3} onChange={(e) => setDraft(e.target.value)} /> : <input {...props} onChange={(e) => setDraft(e.target.value)} />}
    </label>
  );
}

// Settings > Agents: the 200k context cap switch (USAGE-006, on by default). A plain settings
// key; the cap itself is applied in Rust when a Claude or Codex pane starts.
export function AgentsPageView({ cap, onCap }: { cap: boolean; onCap: (on: boolean) => void }) {
  return (
    <section className="conn-card" aria-label="Agents">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={cap} onChange={(e) => onCap(e.target.checked)} />
        <span>
          Hold Claude and Codex to a 200k context window
          <small>
            On unless you turn it off; sessions started from now on follow it. Claude Code compacts at 200k and Codex is given a 200k window that compacts at 180k. A session you set up yourself (the
            variable, or Codex options, a profile or OSS mode on the start line) is left alone, and the meters measure against the same 200k while this is on.
          </small>
        </span>
      </label>
    </section>
  );
}

// STAT-002: one switch for every agent's status hooks, on unless saved off. Rust takes Kolux's
// entries out (or puts them back) when `agent_hooks_sync` runs after the save.
export const HOOKS_FIELD = "agentStatusHooks";
export const hooksOn = (s: Record<string, unknown>) => s[HOOKS_FIELD] !== false;

export function HooksSwitch({ on, onSwitch }: { on: boolean; onSwitch: (on: boolean) => void }) {
  return (
    <section className="conn-card" aria-label="Agent status hooks" data-section="hooks">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onSwitch(e.target.checked)} />
        <span>
          Agent status hooks
          <small>Agents tell Kolux when they work, wait for you or finish. Turning this off removes Kolux's hooks from every agent's settings and stops them being put back; your own hooks stay.</small>
        </span>
      </label>
    </section>
  );
}

export default function AgentsPage() {
  const { settings, error, save: write } = useSettings();
  const [written, setWritten] = useState(0);
  const save = (patch: Record<string, unknown>) => write(patch).then(() => setWritten((n) => n + 1));
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // SESS-002: an errored search is not an empty one
  const [lines, setLines] = useState<Record<string, string>>({});
  const refresh = () => {
    setLooking(true);
    invoke<AgentInfo[]>("agent_list")
      .then((list) => {
        setAgents(list);
        setFailed(null);
        void emit("agents-changed", list);
      })
      .catch((e) => setFailed(String(e) || "the search failed"))
      .finally(() => setLooking(false));
  };
  useEffect(refresh, []);
  useEffect(() => {
    const off = listen<AgentInfo[] | null>("agents-changed", (e) => Array.isArray(e.payload) && setAgents(e.payload));
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  const installed = (agents ?? []).filter((a) => a.installed);
  // What each installed agent starts as with the saved options, read again after every save.
  useEffect(() => {
    if (!settings) return;
    void Promise.all(installed.map((a) => invoke<StartLine>("agent_start_line", { id: a.id, extra: [], prompt: "" }).then((l) => [a.id, [l.program ?? a.program, ...l.args].map((x) => (/\s/.test(x) || x === "" ? `"${x}"` : x)).join(" ")] as const))).then((all) => setLines(Object.fromEntries(all)));
  }, [written, agents, settings === null]);
  if (!settings) return error ? <p className="conn-detail warn">{error}</p> : null;

  const off = disabledAgents(settings);
  const def = defaultAgentId(settings);
  const choices = installed.filter((a) => !off.includes(a.id));
  const savedMissing = def !== "" && !choices.some((a) => a.id === def);
  const nameOf = (id: string) => (agents ?? []).find((a) => a.id === id)?.name ?? id;
  const setOption = (id: string, k: keyof Options, v: string) => {
    const all = { ...((settings[OPTIONS_FIELD] as Record<string, Options> | undefined) ?? {}) };
    all[id] = { ...optionsOf(settings, id), [k]: v };
    return save({ [OPTIONS_FIELD]: all });
  };
  const yolo = settings[PERMISSIONS_FIELD] !== "manual";

  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      <section className="conn-card" data-section="default">
        <h2 className="conn-name">Default agent</h2>
        <select aria-label="default agent" className="field" value={savedMissing ? `saved:${def}` : def} onChange={(e) => save({ [DEFAULT_AGENT_KEY]: e.target.value.replace(/^saved:/, "") })}>
          <option value="">Auto: the first agent available</option>
          {savedMissing && <option value={`saved:${def}`}>{nameOf(def)} (saved, not found right now)</option>}
          {choices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="conn-detail">A new agent tab opens with this agent and its options below. Switching the default agent off leaves no default.</p>
      </section>

      <section className="conn-card" data-section="permissions">
        <h2 className="conn-name">Agent Permissions</h2>
        <Segmented label="Agent Permissions" options={[{ id: "yolo", label: "Yolo" }, { id: "manual", label: "Manual" }]} value={yolo ? "yolo" : "manual"} onPick={(v) => save({ [PERMISSIONS_FIELD]: v })} />
        <p className="conn-detail">{yolo ? "Agents start with the switches that skip their permission prompts, where they have one (Claude Code in its automatic mode, Codex without approvals)." : "Agents ask before they change things."} An agent with its own default arguments below is left as you set it.</p>
      </section>

      <section className="conn-card" data-section="agents">
        <div className="conn-head">
          <h2 className="conn-name">Installed agents</h2>
          <button className="btn conn-add" onClick={refresh} disabled={looking}>
            {looking ? "Looking…" : "Refresh"}
          </button>
        </div>
        {failed ? (
          <p className="conn-detail warn" role="alert">
            Kolux could not look for agent CLIs ({failed}). Press Refresh to try again.
          </p>
        ) : (
          agents !== null && installed.length === 0 && <p className="conn-detail">No agent CLI was found. Install one, then press Refresh.</p>
        )}
        {installed.map((a) => {
          const o = optionsOf(settings, a.id);
          const on = !off.includes(a.id);
          return (
            <div key={a.id} className="agent-row" data-agent={a.id}>
              <label className="agent-on">
                <input type="checkbox" role="switch" checked={on} onChange={(e) => void save(switchAgent(settings, a.id, e.target.checked)).then(() => invoke("agent_hooks_sync")).catch(() => {})} />
                <span className="agent-name">{a.name}</span>
                {a.id === def && on && <span className="conn-chip">default</span>}
              </label>
              <details>
                <summary>How it starts</summary>
                <code className="agent-line">{lines[a.id] ?? ""}</code>
                <Draft label="Command" value={o.command ?? ""} placeholder={a.path ?? a.program} onSave={(v) => setOption(a.id, "command", v)} />
                <Draft label="Default arguments" value={o.args ?? ""} placeholder={a.args.length ? `${a.args.join(" ")} (built in; yours replace these)` : "none"} onSave={(v) => setOption(a.id, "args", v)} />
                <Draft label="Environment" multi value={o.env ?? ""} placeholder="NAME=value, one per line" onSave={(v) => setOption(a.id, "env", v)} />
              </details>
            </div>
          );
        })}
      </section>
      <HooksSwitch on={hooksOn(settings)} onSwitch={(on) => void save({ [HOOKS_FIELD]: on }).then(() => invoke("agent_hooks_sync")).catch(() => {})} />
      <AgentsPageView cap={capOn(settings ?? {})} onCap={(on) => void save({ [CAP_FIELD]: on })} />
    </>
  );
}
