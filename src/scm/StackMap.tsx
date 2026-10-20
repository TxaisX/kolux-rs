// GIT-034 (T-313-b): the stack the checked pull request belongs to, in the Checks tab. Lists the
// chain bottom first, links to the next pull request up, and merges from the bottom up to a chosen
// one after a confirmation that names them. The rules are stack.ts's; this only asks GitHub and shows.
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { mergeActions, mergeLabel, type MergeInfo, type Pr } from "./model";
import { chainThrough, mergeThrough, nextInStack, type StackItem } from "./stack";

type StackList = { trunk: string; prs: StackItem[] };
type Shown = { items: StackItem[]; infos: Record<number, MergeInfo>; holds: Record<number, string | null>; error: string | null };

export default function StackMap({ dir, pr }: { dir: string; pr: Pr }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [confirm, setConfirm] = useState<{ upTo: number; order: number[]; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setNote(null);
    setConfirm(null);
    try {
      const list = await invoke<StackList>("scm_stack_prs", { worktree: dir });
      const chain = pr.head ? chainThrough(list.prs, list.trunk, pr.head) : { items: [] as StackItem[], error: "this pull request's branch is not known" };
      const infos: Record<number, MergeInfo> = {};
      const holds: Record<number, string | null> = {};
      for (const p of chain.items) {
        try {
          const info = await invoke<MergeInfo>("scm_merge_info", { worktree: dir, url: p.url });
          infos[p.number] = info;
          const label = mergeLabel(info);
          holds[p.number] = label === "Ready to merge" ? null : label;
        } catch (e) {
          holds[p.number] = String(e);
        }
      }
      setShown({ items: chain.items, infos, holds, error: chain.error });
    } catch (e) {
      setShown({ items: [], infos: {}, holds: {}, error: String(e) });
    }
  };

  const ask = (upTo: number) => {
    if (!shown) return;
    const plan = mergeThrough(shown.items, upTo, shown.holds);
    if (plan.refused) return setNote(plan.refused);
    setNote(null);
    setConfirm({ upTo, order: plan.order, text: plan.confirm });
  };

  const run = async () => {
    if (!shown || !confirm) return;
    setBusy(true);
    const done: number[] = [];
    try {
      for (const n of confirm.order) {
        const p = shown.items.find((x) => x.number === n)!;
        const step = mergeActions(shown.infos[n]).find((a) => a.action === "merge");
        if (!step) throw new Error(`#${n} offers no direct merge, so the stack stopped there`);
        await invoke("scm_merge", { worktree: dir, url: p.url, action: step.action, method: step.method });
        done.push(n);
      }
      setNote(`Merged ${done.map((n) => `#${n}`).join(", ")}.`);
    } catch (e) {
      setNote(`${done.length ? `Merged ${done.map((n) => `#${n}`).join(", ")}, then stopped: ` : ""}${String(e)}`);
    }
    setConfirm(null);
    setBusy(false);
    void load();
  };

  const next = shown ? nextInStack(shown.items, pr.number) : null;
  return (
    <details className="stack-map" data-stack-map onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void load()}>
      <summary>Stack</summary>
      {shown?.error && <div className="sb-hint">{shown.error}</div>}
      {shown && shown.items.length > 0 && (
        <ol className="stack-list">
          {shown.items.map((p) => (
            <li key={p.number} aria-current={p.number === pr.number ? "true" : undefined}>
              <a href={p.url} onClick={(e) => (e.preventDefault(), void invoke("open_external", { url: p.url }))}>
                #{p.number}
              </a>{" "}
              <span className="name">{p.title || p.head}</span> <code>{p.head}</code> <span className="sb-hint">{shown.holds[p.number] ?? "Ready to merge"}</span>
              <button className="btn" disabled={busy} onClick={() => ask(p.number)}>
                Merge through #{p.number}
              </button>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <button className="btn" data-stack-next onClick={() => void invoke("open_external", { url: next.url })}>
          Open the next pull request (#{next.number})
        </button>
      )}
      {confirm && (
        <div role="alertdialog" aria-label="Confirm the stack merge" className="note" data-stack-confirm>
          {confirm.text}{" "}
          <button className="btn" disabled={busy} onClick={() => void run()}>
            Merge
          </button>
          <button className="btn" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      )}
      {note && <div className="sb-hint" role="status">{note}</div>}
    </details>
  );
}
