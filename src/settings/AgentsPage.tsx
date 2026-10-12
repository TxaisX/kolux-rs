// Settings > Agents: the 200k context cap switch (USAGE-006, on by default). A plain settings
// key; the cap itself is applied in Rust when a Claude or Codex pane starts.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CAP_FIELD, capOn } from "../usage/meter";

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

export default function AgentsPage() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    invoke<Record<string, unknown>>("get_settings").then(setSettings).catch(() => setSettings({}));
  }, []);
  const save = (on: boolean) => {
    setSettings((s) => ({ ...(s ?? {}), [CAP_FIELD]: on }));
    invoke<Record<string, unknown>>("get_settings")
      .then((s) => invoke("save_settings", { value: { ...s, [CAP_FIELD]: on } }))
      .catch(() => {});
  };
  if (!settings) return null;
  return <AgentsPageView cap={capOn(settings)} onCap={save} />;
}
