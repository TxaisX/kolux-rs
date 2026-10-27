// VIEW-074: the Checks panel's empty state for a branch with no pull request. It reads the
// worktree's git state, offers the create composer only when readiness is confirmed (an answer is
// tied to the exact worktree, branch and git state and goes stale after about five minutes), and
// when only a push is missing offers one combined push-and-create action. Rules live in startPr.ts.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { AgentInfo } from "../launch/PlusMenu";
import type { ActionOutcome, Pr, Status } from "./model";
import SearchPick from "../editor/SearchPick";
import { needsOneClick, useOneClick } from "./oneClick";
import OneClickNotice from "./OneClickNotice";
import { draftOffered, draftPrText, settleDraft, startGatedOneClick, writingAfter, type DraftGate } from "./prDraft";
import { assess, confirmed, dismiss, errorShown, offerFor, raise, readinessKey, type ErrorBook, type Offer, type Readiness } from "./startPr";

type Props = { dir: string; onCreated: (pr: Pr) => void };
type Draft = { title: string; body: string; base: string; draft: boolean };

/** Hard errors by worktree live outside the component so another worktree's panel never clears them. */
let errors: ErrorBook = {};

export default function PrStart({ dir, onCreated }: Props) {
  const [seen, setSeen] = useState<{ dir: string; status: Status; ready: Readiness } | null>(null);
  const [, tick] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<string[]>([]); // EDIT-048: the Base box suggests from these
  const [aiOffered, setAiOffered] = useState(false); // GIT-024: the AI draft button follows the Source Control writer switches
  const [writing, setWriting] = useState<string | null>(null); // the worktree a draft is running for, so another worktree never shows "Writing…"
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const going = useOneClick(dir);
  const asking = useRef(dir);
  asking.current = dir;
  const latest = useRef<Draft | null>(null);
  latest.current = draft;
  const session = useRef(0); // bumped each time the composer opens or closes; a draft finishing in an older one is dropped

  const check = async (): Promise<{ status: Status; ready: Readiness } | null> => {
    try {
      const status = await invoke<Status>("scm_status", { worktree: dir });
      if (asking.current !== dir) return null;
      const got = { dir, status, ready: assess(dir, status, Date.now()) };
      setSeen(got);
      return got;
    } catch (err) {
      errors = raise(errors, dir, "status", `The branch could not be checked: ${String(err)}`);
      tick((n) => n + 1);
      return null;
    }
  };
  useEffect(() => {
    session.current++;
    setDraft(null);
    setSeen(null);
    setWriteNote(null);
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  // The answer on screen is only ever this worktree's.
  const mine = seen && seen.dir === dir ? seen : null;
  const key = mine ? readinessKey(dir, mine.status) : null;
  const offer: Offer = offerFor(mine?.ready ?? null, key, Date.now());
  const failed = errorShown(errors, dir, key ?? "status");

  const fail = (message: string) => {
    errors = raise(errors, dir, key ?? "status", message);
    tick((n) => n + 1);
  };
  // The composer opens only on a confirmed answer; a stale one is read again first.
  const open = async () => {
    errors = dismiss(errors, dir);
    let now: { status: Status; ready: Readiness } | null = mine;
    if (!now || !confirmed(now.ready, readinessKey(dir, now.status), Date.now())) now = await check();
    if (!now || now.ready.reason !== null) return tick((n) => n + 1);
    session.current++;
    setDraft({ title: "", body: "", base: (now.status.base ?? "").replace(/^origin\//, ""), draft: false });
    invoke<string[]>("worktree_branches", { path: dir }).then((b) => asking.current === dir && setBranches(b), () => setBranches([]));
    setAiOffered(false);
    setWriteNote(null);
    void offerDraft();
  };
  // The gate is read fresh each time: settings, the repository and the installed agents can all change while the composer is open.
  const readGate = async () => {
    const settings = await invoke<Record<string, unknown>>("get_settings").catch(() => ({}));
    const repo = await invoke<{ owner: string; name: string } | null>("scm_github_repo", { worktree: dir }).catch(() => null);
    const agents = await invoke<AgentInfo[]>("agent_list").catch(() => [] as AgentInfo[]);
    const gate: DraftGate = { repo: repo ? `${repo.owner}/${repo.name}` : null, agents };
    return { settings, gate };
  };
  const offerDraft = async () => {
    const { settings, gate } = await readGate();
    if (asking.current === dir) setAiOffered(draftOffered(settings, gate.repo, gate.agents));
  };
  // GIT-024: the writer fills title and description; a failure is shown and the typed text stays.
  const write = async (d: Draft) => {
    const snap = { title: d.title, body: d.body };
    const started = session.current;
    setWriting(dir);
    setWriteNote(null);
    const { settings, gate } = await readGate();
    const result = await draftPrText(dir, d.base.trim(), settings, gate);
    if (asking.current === dir) {
      if (result.state === "off") setAiOffered(false);
      if (session.current === started) {
        if (result.state === "off") setWriteNote("Writing with AI is switched off or has no usable writer, so nothing was written.");
        if (result.state === "failed") setWriteNote(result.message);
        if (result.state === "busy") setWriteNote("A draft is already being written for this worktree.");
      }
      const out = settleDraft(latest.current, snap, result, started, session.current);
      setDraft(out.draft);
      if (out.note) setWriteNote(out.note);
    }
    setWriting((w) => writingAfter(w, dir, result));
  };
  const create = async (d: Draft, push: "none" | "publish" | "push") => {
    setBusy(true);
    errors = dismiss(errors, dir);
    try {
      if (push !== "none") {
        const out = await invoke<ActionOutcome>("scm_remote", { worktree: dir, action: push });
        if (!out.ok) return fail(`The push failed, so no pull request was created: ${out.output}`);
      }
      const pr = await invoke<Pr>("scm_pr_create", { worktree: dir, title: d.title, body: d.body, base: d.base, draft: d.draft });
      session.current++;
      setDraft(null);
      onCreated(pr);
    } catch (err) {
      fail(String(err));
    } finally {
      setBusy(false);
    }
  };
  const push = mine && mine.ready.reason === null ? mine.ready.push : "none";
  // GIT-022: with work still to commit or push, one click does all of it and opens the review.
  const oneClick = async () => {
    errors = dismiss(errors, dir);
    const { settings, gate } = await readGate();
    const done = await startGatedOneClick(dir, settings, gate);
    if (done.state === "done" && done.pr) onCreated(done.pr);
    void check();
  };

  return (
    <div className="pr-start" data-pr-start>
      <div className="sb-hint">There is no review for this branch: it has no pull request.</div>
      {failed && (
        <div className="note error" role="alert">
          {failed}
        </div>
      )}
      {offer.kind === "blocked" && !draft && <div className="sb-hint">{offer.reason}</div>}
      {mine && !draft && offer.kind === "blocked" && going?.state !== "running" && needsOneClick(mine.status) && (
        <button className="btn primary" data-pr-one-click onClick={() => void oneClick()}>
          Commit, push and create pull request
        </button>
      )}
      <OneClickNotice dir={dir} />
      {offer.kind === "check" && !failed && <div className="sb-hint">Checking whether this branch is ready…</div>}
      {(offer.kind === "create" || offer.kind === "push-create") && !draft && (
        <button className="btn primary" data-pr-open onClick={() => void open()}>
          {offer.kind === "push-create" ? (offer.push === "publish" ? "Publish branch and create pull request" : "Push and create pull request") : "Create pull request"}
        </button>
      )}
      {draft && (
        <div className="scm-ask scm-pr" role="dialog" aria-label="Create pull request">
          <input className="field" aria-label="pull request title" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className="field multi" aria-label="pull request description" placeholder="Description" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          {aiOffered && (
            <div className="btn-row">
              <button className="btn" data-pr-draft disabled={writing === dir || busy || !draft.base.trim()} title="Write the title and description from this branch's changes" onClick={() => void write(draft)}>
                {writing === dir ? "Writing…" : "Write with AI"}
              </button>
            </div>
          )}
          {writeNote && (
            <div className="note warn" role="status">
              {writeNote}
            </div>
          )}
          <label className="scm-pr-base">
            <span>Base</span>
            <SearchPick items={branches} label="base branch" value={draft.base} onChange={(base) => setDraft({ ...draft, base })} />
          </label>
          <label className="conn-switch">
            <input type="checkbox" checked={draft.draft} onChange={(e) => setDraft({ ...draft, draft: e.target.checked })} />
            <span>Open as a draft</span>
          </label>
          <div className="btn-row">
            <button className="btn primary" data-pr-create disabled={busy || !draft.title.trim() || !draft.base.trim()} title={!draft.title.trim() ? "Write a title first" : undefined} onClick={() => void create(draft, push)}>
              {busy ? "Creating…" : `${push === "none" ? "Create" : "Push and create"}${draft.draft ? " draft" : ""} pull request`}
            </button>
            <button className="btn" onClick={() => (session.current++, setDraft(null), setWriteNote(null))}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
