// Settings > Git & worktrees. PROJ-022 / SET-031: how new branches begin; the default compare base;
// PROJ-070: whether deleting one clean workspace asks first. T-116-a-fix moved the first two here from the sidebar gear.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CONFIRM_DELETE_FIELD, asksBeforeDelete } from "../projects/deleting";
import { prefixSample, type PrefixCheck } from "../projects/model";
import { SUMMARY_UPSTREAM_KEY } from "../scm/model";
import { useSettings } from "./useSettings";

type ViewProps = {
  settings: Record<string, unknown>;
  save: (patch: Record<string, unknown>) => unknown;
  draft: string;
  setDraft: (v: string) => void;
  check: PrefixCheck | null;
};

const modeOf = (s: Record<string, unknown>) => (typeof s.branchPrefix === "string" ? s.branchPrefix : "user");

export function GitView({ settings, save, draft, setDraft, check }: ViewProps) {
  const mode = modeOf(settings);
  const sample = prefixSample(mode, draft, check);
  return (
    <>
      <section className="conn-card" data-section="branches">
        <h2 className="conn-name">New branches</h2>
        <label className="conn-detail">Branch prefix</label>
        <select aria-label="branch prefix" className="field" value={mode} onChange={(e) => save({ branchPrefix: e.target.value })}>
          <option value="user">Git user name, e.g. txais-xiong/</option>
          <option value="custom">Custom text</option>
          <option value="none">None: the bare name</option>
        </select>
        {mode === "custom" && <input aria-label="custom branch prefix" className="field" placeholder="e.g. tx/" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== String(settings.branchPrefixCustom ?? "") && save({ branchPrefixCustom: draft })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />}
        <p className="conn-detail" data-prefix-sample>
          Next branch: <code>{sample.sample}</code>
        </p>
        {sample.note && (
          <p className="conn-detail warn" role="alert">
            {sample.note}
          </p>
        )}
        <label className="conn-detail">Default compare base</label>
        <select aria-label="default compare base" className="field" value={settings[SUMMARY_UPSTREAM_KEY] === true ? "upstream" : "default"} onChange={(e) => save({ [SUMMARY_UPSTREAM_KEY]: e.target.value === "upstream" })}>
          <option value="default">Repository default</option>
          <option value="upstream">Branch upstream</option>
        </select>
      </section>
      <section className="conn-card" data-section="deleting">
        <h2 className="conn-name">Deleting workspaces</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={asksBeforeDelete(settings)} onChange={(e) => save({ [CONFIRM_DELETE_FIELD]: e.target.checked })} />
          Ask before deleting a workspace
        </label>
        <p className="conn-detail">With this off, a workspace with nothing uncommitted is deleted at once. One with changes, a lock or another workspace inside it always asks.</p>
      </section>
    </>
  );
}

export default function GitPage() {
  const { settings, error, save } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const [check, setCheck] = useState<PrefixCheck | null>(null);
  const typed = draft ?? String(settings?.branchPrefixCustom ?? "");
  const mode = settings ? modeOf(settings) : null;
  useEffect(() => {
    if (!mode) return;
    let live = true;
    invoke<PrefixCheck>("branch_prefix_check", { mode, custom: typed })
      .then((c) => live && setCheck(c))
      .catch(() => live && setCheck(null));
    return () => {
      live = false;
    };
  }, [mode, typed]);
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GitView settings={settings} save={save} draft={typed} setDraft={setDraft} check={check} />}
    </>
  );
}
