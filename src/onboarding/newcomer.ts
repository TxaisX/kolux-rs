// ONB-013: the newcomer checklist: four plain first-success items, worked out from the first-run
// record's milestones (ONB-011) and the guide's tried list, never from clicks on the list itself.
import { checklistChanged, type Milestone } from "./firstRun";
import { markGuide } from "./guide";

/** What guide_get gives for the first-run record (onboarding.rs FirstRun); null for a profile
 *  from before the wizard, which never gets the checklist. */
export type FirstRun = { closed: boolean; outcome: string | null; checklistDismissed: boolean; milestones: Partial<Record<Milestone, number>> };

export type ItemId = "connect" | "kit" | "results" | "ownFile";

/** The tried-list ids: a kit run on the user's own file, and the one-time all-done toast. */
export const OWN_FILE = "own-file";
export const ALL_DONE = "checklist-done";

/** The fixed order the checklist points through. */
export const ITEMS: readonly { id: ItemId; label: string; about: string }[] = [
  { id: "connect", label: "Connect an AI", about: "Sign in to Claude, Codex or another agent so Kolux can start it for you." },
  { id: "kit", label: "Run a kit", about: "Pick a ready-made kit and let it run on the sample data." },
  { id: "results", label: "Open your results", about: "Look at what the kit made once it finishes." },
  { id: "ownFile", label: "Run it on your own file", about: "Run a kit again, this time on a file of your own." },
];

const FROM: Record<Exclude<ItemId, "ownFile">, Milestone> = { connect: "aiConnected", kit: "kitLaunched", results: "resultsOpened" };

export type Checklist = {
  /** The list is shown: a profile that has closed the wizard and not dismissed the checklist. */
  show: boolean;
  /** The record was read; a list still loading never counts as done. */
  ready: boolean;
  ticked: ReadonlySet<ItemId>;
  /** The first unticked item in the fixed order; none once all four are ticked. */
  next: ItemId | null;
  done: boolean;
};

/** ONB-013: `first` undefined = not read yet; null = no first-run record (an older profile). */
export function checklistOf(first: FirstRun | null | undefined, tried: readonly string[]): Checklist {
  const ready = first !== undefined;
  const ticked = new Set<ItemId>();
  if (first) {
    for (const [item, m] of Object.entries(FROM) as [ItemId, Milestone][]) if (typeof first.milestones[m] === "number") ticked.add(item);
    if (tried.includes(OWN_FILE)) ticked.add("ownFile");
  }
  const next = ITEMS.find((i) => !ticked.has(i.id))?.id ?? null;
  return { show: !!first && first.closed && !first.checklistDismissed, ready, ticked, next, done: ready && !!first && next === null };
}

/** ONB-013: the all-done toast fires once per profile: only when the list is done, the profile has
 *  not had it (the ALL_DONE tried mark) and this window has not fired it already (a redraw). */
export function allDoneToast(markWith: (id: string) => Promise<unknown> = (id) => markGuide("tried", id)) {
  let fired = false;
  return (c: Checklist, tried: readonly string[]): boolean => {
    if (fired || !c.done || tried.includes(ALL_DONE)) return false;
    fired = true;
    void markWith(ALL_DONE).catch(() => {});
    return true;
  };
}

/** ONB-013: the kits flow calls this when a kit runs on a file the user picked (not the sample);
 *  the checklist's last item ticks from it. Silent when the write fails. */
export const ranOnOwnFile = (markWith: (id: string) => Promise<unknown> = (id) => markGuide("tried", id)): Promise<void> =>
  markWith(OWN_FILE).then(
    () => checklistChanged(),
    () => {},
  );

export const ALL_DONE_TEXT = "You are all set: you connected an AI, ran a kit, opened its results and ran it on your own file.";
