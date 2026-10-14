import { expect, test } from "vitest";
import { loadRepoFacts, type ParentRead, type Person, resetFacts } from "./repoFacts";

/** A stand-in for the app's commands: each answer waits until the test releases it. */
function slowCalls(answers: Record<string, unknown>, fail: string[] = []) {
  const pending: (() => void)[] = [];
  const call = <T,>(cmd: string, args: Record<string, unknown>) =>
    new Promise<T>((ok, no) => pending.push(() => (fail.includes(cmd) ? no(new Error(`${cmd} failed`)) : ok((typeof answers[cmd] === "function" ? (answers[cmd] as (a: unknown) => unknown)(args) : answers[cmd]) as T))));
  /** Releases the answers asked for so far, once, then lets their handlers run. */
  const step = async () => {
    pending.splice(0).forEach((go) => go());
    await new Promise((r) => setTimeout(r, 0));
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await step();
  };
  return { call, step, flush };
}

const last = <T,>(xs: T[]) => xs[xs.length - 1];

function recorder() {
  const seen = { gh: [] as unknown[], login: [] as unknown[], parent: [] as ParentRead[], people: [] as Person[][], labels: [] as string[][] };
  const set = { gh: (v: unknown) => seen.gh.push(v), login: (v: unknown) => seen.login.push(v), parent: (v: ParentRead) => seen.parent.push(v), people: (v: Person[]) => seen.people.push(v), labels: (v: string[]) => seen.labels.push(v) };
  return { seen, set };
}

const forkA = {
  scm_github_repo: { host: "github.com", owner: "me", name: "fork-a" },
  scm_gh_account: "me",
  github_repo_parent: "up/stream-a",
  github_people: [{ login: "ana", avatar: "" }],
  scm_repo_labels: [{ name: "bug", color: "" }],
};

test("FIX-1: late answers for a project that is no longer open never land", async () => {
  const { call, flush } = slowCalls(forkA);
  const { seen, set } = recorder();
  let live = true;
  const done = loadRepoFacts(call, "C:/a", () => live, set);
  live = false; // the user switched to project B before any answer came back
  await flush();
  await done;
  expect(seen).toEqual({ gh: [], login: [], parent: [], people: [], labels: [] });
});

test("FIX-1: a switch after the repository answer still drops the parent, people and labels of the old project", async () => {
  const { call, step, flush } = slowCalls(forkA);
  const { seen, set } = recorder();
  let live = true;
  const done = loadRepoFacts(call, "C:/a", () => live, set);
  await step(); // only the repository answer comes back in the first round...
  expect(seen.gh).toEqual([forkA.scm_github_repo]);
  live = false; // ...and the parent, people, labels and account would arrive for a project no longer open
  await flush();
  await done;
  expect(seen.gh).toHaveLength(1);
  expect({ login: seen.login, parent: seen.parent, people: seen.people, labels: seen.labels }).toEqual({ login: [], parent: [], people: [], labels: [] });
});

test("FIX-1: an open project gets every fact, and a reset clears people and labels with the parent", async () => {
  const { call, flush } = slowCalls(forkA);
  const { seen, set } = recorder();
  await Promise.all([loadRepoFacts(call, "C:/a", () => true, set), flush()]);
  await flush();
  expect(seen.parent).toEqual([{ parent: "up/stream-a", failed: false }]);
  expect(seen.people).toEqual([[{ login: "ana", avatar: "" }]]);
  expect(seen.labels).toEqual([["bug"]]);
  resetFacts(set);
  expect(last(seen.parent)).toEqual({ parent: undefined, failed: false });
  expect(last(seen.people)).toEqual([]);
  expect(last(seen.labels)).toEqual([]);
  expect(last(seen.gh)).toBeUndefined();
});

test("FIX-1: a failed parent read is reported as failed, not as still checking", async () => {
  const { call, flush } = slowCalls(forkA, ["github_repo_parent"]);
  const { seen, set } = recorder();
  await Promise.all([loadRepoFacts(call, "C:/a", () => true, set), flush()]);
  await flush();
  expect(seen.parent).toEqual([{ parent: undefined, failed: true }]);
});
