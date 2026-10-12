// Settings > Git & worktrees. SET-031 / GIT-066: how new branches begin (the git user name,
// then the gh login; custom text; or none), the default compare base, and whether a new
// workspace refreshes its base first. PROJ-070: whether deleting one clean workspace asks first.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CONFIRM_DELETE_FIELD, asksBeforeDelete } from "../projects/deleting";
import { prefixSample, type PrefixCheck } from "../projects/model";
import { SUMMARY_UPSTREAM_KEY } from "../scm/model";
import { useSettings } from "./useSettings";

const REFRESH_FIELD = "refreshBaseFirst";

export default function GitPage() {
  const { settings, error, save } = useSettings();
  const mode = typeof settings?.branchPrefix === "string" ? settings.branchPrefix : "user";
  const [draft, setDraft] = useState<string | null>(null);
  const custom = draft ?? String(settings?.branchPrefixCustom ?? "");
  const [check, setCheck] = useState<PrefixCheck | null>(null);
  useEffect(() => {
    if (!settings) return;
    let live = true;
    invoke<PrefixCheck>("branch_prefix_check", { mode, custom })
      .then((c) => live && setCheck(c))
      .catch(() => live && setCheck(null));
    return () => {
      live = false;
    };
  }, [settings, mode, custom]);
  const sample = prefixSample(mode, custom, check);
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <>
          <section className="conn-card" data-section="branches">
            <h2 className="conn-name">Branch names</h2>
            <div className="look-select">
              <span>Branch prefix</span>
              <select aria-label="branch prefix" className="field" value={mode} onChange={(e) => void save({ branchPrefix: e.target.value })}>
                <option value="user">Git user name (or gh login)</option>
                <option value="custom">Custom text</option>
                <option value="none">None: the bare name</option>
              </select>
            </div>
            {mode === "custom" && (
              <input
                aria-label="custom branch prefix"
                className="field"
                placeholder="e.g. feat"
                value={custom}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => custom !== String(settings.branchPrefixCustom ?? "") && void save({ branchPrefixCustom: custom })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            )}
            <p className="conn-detail" data-prefix-sample>
              Next branch: <code>{sample.sample}</code>
            </p>
            {sample.note && (
              <p className="conn-detail warn" role="alert">
                {sample.note}
              </p>
            )}
            {mode === "user" && check && !check.prefix && <p className="conn-detail">No git user name or gh login was found, or it is too long, so new branches get the bare name.</p>}
          </section>
          <section className="conn-card" data-section="base">
            <h2 className="conn-name">Base branch</h2>
            <div className="look-select">
              <span>Default compare base</span>
              <select aria-label="default compare base" className="field" value={settings[SUMMARY_UPSTREAM_KEY] === true ? "upstream" : "default"} onChange={(e) => void save({ [SUMMARY_UPSTREAM_KEY]: e.target.value === "upstream" })}>
                <option value="default">Repository default</option>
                <option value="upstream">Branch upstream</option>
              </select>
            </div>
            <label className="conn-switch">
              <input type="checkbox" role="switch" aria-label="Refresh the base first" checked={settings[REFRESH_FIELD] === true} onChange={(e) => void save({ [REFRESH_FIELD]: e.target.checked })} />
              Refresh the base first
            </label>
            <p className="conn-detail">A new workspace brings its local base branch up to the remote first. It only fast-forwards: a base with commits of its own, or with uncommitted changes in its worktree, is left as it is. With this off, Kolux says when the base is behind.</p>
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
      )}
    </>
  );
}
