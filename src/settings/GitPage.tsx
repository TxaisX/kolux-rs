// Settings > Git & worktrees. SET-031 / GIT-066: how new branches begin (the git user name,
// then the gh login; custom text; or none), the default compare base, and whether a new
// workspace refreshes its base first, and the order of the Source Control groups. PROJ-070: whether deleting one clean workspace asks first. T-116-a-fix moved the prefix and compare base here from the sidebar gear.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CONFIRM_DELETE_FIELD, asksBeforeDelete } from "../projects/deleting";
import { prefixSample, type PrefixCheck } from "../projects/model";
import { budgetLine, budgetLow, type Budget, SCM_GROUP_ORDERS, SCM_GROUP_ORDER_KEY, scmGroups, SUMMARY_UPSTREAM_KEY } from "../scm/model";
import { useSettings } from "./useSettings";
import { WRITER_COMMAND_KEY, WRITER_INSTRUCTIONS_KEY, WRITER_KEY } from "../scm/generate";

const REFRESH_FIELD = "refreshBaseFirst";

type BudgetView = { rows: Budget[] | null; error: string | null; at: number };

type ViewProps = {
  settings: Record<string, unknown>;
  save: (patch: Record<string, unknown>) => unknown;
  draft: string;
  setDraft: (v: string) => void;
  check: PrefixCheck | null;
  /** GIT-028: the GitHub API budget as last read, and how to read it again. */
  budget?: BudgetView;
  onBudget?: () => void;
};

const modeOf = (s: Record<string, unknown>) => (typeof s.branchPrefix === "string" ? s.branchPrefix : "user");

export function GitView({ settings, save, draft, setDraft, check, budget = { rows: null, error: null, at: 0 }, onBudget }: ViewProps) {
  const mode = modeOf(settings);
  const sample = prefixSample(mode, draft, check);
  return (
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== String(settings.branchPrefixCustom ?? "") && void save({ branchPrefixCustom: draft })}
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
      <section className="conn-card" data-section="scm-groups">
        <h2 className="conn-name">Source Control</h2>
        <div className="look-select">
          <span>Group order</span>
          <select aria-label="source control group order" className="field" value={(SCM_GROUP_ORDERS.find((o) => o[0] === settings[SCM_GROUP_ORDER_KEY]) ?? SCM_GROUP_ORDERS[0])[0]} onChange={(e) => void save({ [SCM_GROUP_ORDER_KEY]: e.target.value })}>
            {SCM_GROUP_ORDERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="conn-detail" data-group-order>
          The list reads {scmGroups(settings[SCM_GROUP_ORDER_KEY]).map((g) => g[0].toUpperCase() + g.slice(1)).join(", then ")}. Conflicts always come first, since they hold up a commit.
        </p>
      </section>
      <section className="conn-card" data-section="commit-writer">
        <h2 className="conn-name">Commit messages</h2>
        <div className="look-select">
          <span>Written by</span>
          <select aria-label="commit message writer" className="field" value={settings[WRITER_KEY] === "custom" || settings[WRITER_KEY] === "off" ? String(settings[WRITER_KEY]) : "claude"} onChange={(e) => void save({ [WRITER_KEY]: e.target.value })}>
            <option value="claude">Claude Code</option>
            <option value="custom">Custom command</option>
            <option value="off">Off: no generate button</option>
          </select>
        </div>
        {settings[WRITER_KEY] === "custom" && (
          <>
            <input
              key={String(settings[WRITER_COMMAND_KEY] ?? "")}
              aria-label="custom commit message command"
              className="field"
              placeholder="e.g. my-writer --text {prompt}"
              defaultValue={String(settings[WRITER_COMMAND_KEY] ?? "")}
              onBlur={(e) => e.target.value !== String(settings[WRITER_COMMAND_KEY] ?? "") && void save({ [WRITER_COMMAND_KEY]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <p className="conn-detail">The prompt goes wherever <code>{"{prompt}"}</code> appears in the command, or on its standard input when it does not. Put quotes around a word with spaces in it; backslashes are kept as typed.</p>
          </>
        )}
        <textarea
          key={String(settings[WRITER_INSTRUCTIONS_KEY] ?? "")}
          aria-label="commit message instructions"
          className="field multi"
          maxLength={2000}
          placeholder="Your own instructions for the message, e.g. use the imperative mood (optional)"
          defaultValue={String(settings[WRITER_INSTRUCTIONS_KEY] ?? "")}
          onBlur={(e) => e.target.value !== String(settings[WRITER_INSTRUCTIONS_KEY] ?? "") && void save({ [WRITER_INSTRUCTIONS_KEY]: e.target.value })}
        />
        <p className="conn-detail">The spark button beside the commit message asks for a message describing what is staged.</p>
      </section>
      <section className="conn-card" data-section="gh-budget">
        <h2 className="conn-name">GitHub API budget</h2>
        {budget.rows === null && budget.error === null && <p className="conn-detail">Reading the budget{"\u2026"}</p>}
        {budget.error && <p className="conn-detail warn">{budget.error}</p>}
        {budget.rows?.map((b) => (
          <p key={b.name} className={budgetLow(b) ? "conn-detail warn" : "conn-detail"} data-budget={b.name}>
            {budgetLine(b, budget.at)}
          </p>
        ))}
        <div className="btn-row">
          <button className="btn" data-budget-refresh onClick={onBudget}>
            Check again
          </button>
        </div>
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
  // GIT-066 / GIT-028: the GitHub API budget, read when the page opens and on request.
  const [budget, setBudget] = useState<{ rows: Budget[] | null; error: string | null; at: number }>({ rows: null, error: null, at: 0 });
  const readBudget = () =>
    invoke<Budget[]>("scm_gh_budget")
      .then((rows) => setBudget({ rows, error: null, at: Date.now() / 1000 }))
      .catch((err) => setBudget({ rows: null, error: String(err), at: Date.now() / 1000 }));
  useEffect(() => void readBudget(), []);
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GitView settings={settings} save={save} draft={typed} setDraft={setDraft} check={check} budget={budget} onBudget={() => void readBudget()} />}
    </>
  );
}
