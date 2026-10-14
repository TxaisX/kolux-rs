// Tasks: what the page reads about the open project's GitHub repository (T-314-a, FIX-1): the
// repository itself, the signed-in account, a fork's parent (GIT-055), the people (GIT-053/054) and
// the labels. Every answer is dropped once the project changed (`live()` false), so a late answer
// for project A can never land while project B is open.

export type GhRepo = { host: string; owner: string; name: string };
export type Person = { login: string; avatar: string };
/** A fork's parent read: undefined while checking, null when there is none, "failed" when the read
 * itself went wrong (shown as a warning, never as still checking). */
export type ParentRead = { parent: string | null | undefined; failed: boolean };

export type RepoFacts = {
  gh: (g: GhRepo | null | undefined) => void;
  login: (l: string | null) => void;
  parent: (p: ParentRead) => void;
  people: (p: Person[]) => void;
  labels: (l: string[]) => void;
};

type Call = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** The reset every project change starts with: nothing known yet. */
export function resetFacts(set: RepoFacts) {
  set.gh(undefined);
  set.login(null);
  set.parent({ parent: undefined, failed: false });
  set.people([]);
  set.labels([]);
}

/** Reads every fact for the checkout `dir`; answers arriving after `live()` turned false are dropped. */
export function loadRepoFacts(call: Call, dir: string, live: () => boolean, set: RepoFacts): Promise<void> {
  const when =
    <T>(f: (v: T) => void) =>
    (v: T) => {
      if (live()) f(v);
    };
  return call<GhRepo | null>("scm_github_repo", { worktree: dir }).then(
    (g) => {
      if (!live()) return;
      set.gh(g);
      if (!g) return;
      const repo = `${g.owner}/${g.name}`;
      void call<string | null>("scm_gh_account", { host: g.host }).then(when(set.login), () => {});
      void call<string | null>("github_repo_parent", { host: g.host, repo }).then(
        when((p: string | null) => set.parent({ parent: p, failed: false })),
        when(() => set.parent({ parent: undefined, failed: true })),
      );
      void call<Person[]>("github_people", { host: g.host, repo }).then(when(set.people), when(() => set.people([])));
      void call<{ name: string }[]>("scm_repo_labels", { host: g.host, repo }).then(
        when((l: { name: string }[]) => set.labels(l.map((x) => x.name))),
        when(() => set.labels([])),
      );
    },
    when(() => set.gh(null)),
  );
}
