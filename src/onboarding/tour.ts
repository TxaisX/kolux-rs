// ONB-031 contextual tour overlay, ONB-032 when tours start by themselves and ONB-033 the
// catalogue: the pure rules behind Tours.tsx. Targets are CSS selectors into the live window.
import { locale } from "../language";

type Words = { title: string; body: string };
export type Side = "top" | "bottom" | "left" | "right";
export type TourStep = {
  target: string;
  side: Side;
  en: Words;
  ko: Words;
  /** Swaps Next for a button that does the step's job (the parallel tour's Split terminal). */
  action?: { en: string; ko: string; run: "split" };
  /** The real control is what to click, so there is no Next. */
  noNext?: boolean;
};
export type TourId = "tasks" | "automations" | "parallel";
export type Tour = { id: TourId; name: string; trigger: string; steps: TourStep[]; ring?: boolean };

/** The split button of the focused terminal pane (browser panes have no split). */
export const FOCUSED_SPLIT = ".pane.focused:not(.browser) .pane-head button[title^='Split right']";

/** ONB-033, the surfaces Kolux RS has today; the board, browser, floating-workspace and
 *  workspace-creation tours wait for their surfaces (T-245-b), the grid tour for T-208-b. */
export const TOURS: Tour[] = [
  {
    id: "tasks",
    name: "Tasks",
    trigger: "[data-tasks] .tasks-list li",
    steps: [
      { target: "[data-tasks] .tasks-list li", side: "bottom", en: { title: "Start from a row", body: "Click an issue or pull request to read it and start an agent on it." }, ko: { title: "행에서 시작", body: "이슈나 풀 리퀘스트를 클릭해 읽고 에이전트에게 맡기세요." } },
      { target: "[data-tasks] select[aria-label=Preset]", side: "bottom", en: { title: "Pick the source", body: "Choose which list of issues and pull requests to show." }, ko: { title: "출처 고르기", body: "보여 줄 이슈와 풀 리퀘스트 목록을 고릅니다." } },
      { target: "[data-tasks] .autos-search", side: "bottom", en: { title: "Filter", body: "Narrow the list with a GitHub search, such as is:pr label:bug." }, ko: { title: "필터", body: "is:pr label:bug 같은 GitHub 검색으로 목록을 좁힙니다." } },
    ],
  },
  {
    id: "automations",
    name: "Automations",
    trigger: ".autos:not(.tasks) .autos-bar .btn.primary",
    steps: [
      { target: ".autos:not(.tasks) .autos-bar .btn.primary", side: "bottom", en: { title: "Create an automation", body: "Give an agent a job that runs on a schedule, by itself." }, ko: { title: "자동화 만들기", body: "에이전트에게 일정에 따라 스스로 실행되는 일을 맡깁니다." } },
      { target: ".autos:not(.tasks) .autos-bar button[title^='Every automation']", side: "bottom", en: { title: "See the results", body: "Every run of every automation, with what it did, in one place." }, ko: { title: "결과 보기", body: "모든 자동화의 실행과 결과를 한곳에서 봅니다." } },
    ],
  },
  {
    id: "parallel",
    name: "Agents in parallel",
    trigger: FOCUSED_SPLIT,
    ring: true,
    steps: [
      { target: FOCUSED_SPLIT, side: "bottom", action: { en: "Split terminal", ko: "터미널 나누기", run: "split" }, en: { title: "Run agents side by side", body: "Split the pane to get a second terminal in the same folder." }, ko: { title: "에이전트를 나란히", body: "창을 나눠 같은 폴더에서 두 번째 터미널을 엽니다." } },
      { target: "aside button[title^='New workspace']", side: "right", noNext: true, en: { title: "Start another task", body: "A new workspace gives the next agent its own copy of the project, so the two never collide." }, ko: { title: "다른 작업 시작", body: "새 작업 공간은 다음 에이전트에게 프로젝트의 별도 사본을 주므로 서로 부딪히지 않습니다." } },
    ],
  },
];

export const stepWords = (s: TourStep): Words => (locale() === "ko" ? s.ko : s.en);
export const actionWord = (s: TourStep) => (s.action ? (locale() === "ko" ? s.action.ko : s.action.en) : null);

/** A step label only when more than one step shows: "2 of 3". */
export const stepLabel = (i: number, n: number) => (n > 1 ? `${i + 1} of ${n}` : null);

/** The next step after `i` (or the first, from -1) whose target is present; null when none is. */
export function nextShown(present: readonly boolean[], i: number): number | null {
  for (let j = i + 1; j < present.length; j++) if (present[j]) return j;
  return null;
}
export function prevShown(present: readonly boolean[], i: number): number | null {
  for (let j = i - 1; j >= 0; j--) if (present[j]) return j;
  return null;
}

/** Whether a tour may start by itself this launch (replay buttons skip every one of these). */
export function autoStarts(o: { id: TourId; auto: boolean | null; seen: readonly string[]; slotUsed: boolean; blocked: boolean; tried: readonly string[] }): boolean {
  if (!o.auto || o.slotUsed || o.blocked || o.seen.includes(o.id)) return false;
  // ONB-033: the parallel tour only for someone who has never split a pane.
  return !(o.id === "parallel" && o.tried.includes("split"));
}

/** Waiting for a first target gives up after this many looks, a quarter second apart. */
export const FIRST_TARGET_TRIES = 20;

export type Rect = { left: number; top: number; width: number; height: number };
export type Placed = { left: number; top: number; side: Side | null };
const GAP = 10;

/** ONB-031: the panel on the step's side of the target when it fits, else the opposite side, else
 *  any side that fits; with no room anywhere it stays inside `b`, covering the target. A null
 *  side means no arrow. */
export function place(t: Rect, p: { width: number; height: number }, b: Rect, want: Side): Placed {
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const order: Side[] = [want, opposite[want], ...(["bottom", "top", "right", "left"] as Side[]).filter((s) => s !== want && s !== opposite[want])];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const cx = t.left + t.width / 2 - p.width / 2;
  const cy = t.top + t.height / 2 - p.height / 2;
  for (const s of order) {
    const at =
      s === "bottom"
        ? { left: cx, top: t.top + t.height + GAP }
        : s === "top"
          ? { left: cx, top: t.top - GAP - p.height }
          : s === "right"
            ? { left: t.left + t.width + GAP, top: cy }
            : { left: t.left - GAP - p.width, top: cy };
    const fits = s === "bottom" || s === "top" ? at.top >= b.top && at.top + p.height <= b.top + b.height : at.left >= b.left && at.left + p.width <= b.left + b.width;
    if (fits) return { side: s, left: clamp(at.left, b.left, b.left + b.width - p.width), top: clamp(at.top, b.top, b.top + b.height - p.height) };
  }
  return { side: null, left: clamp(cx, b.left, b.left + b.width - p.width), top: clamp(cy, b.top, b.top + b.height - p.height) };
}

// ---- asking for a tour from anywhere (the help menu's replay items) ----
export const REPLAY_TOUR = "kolux-replay-tour";
export const replayTour = (id: TourId) => window.dispatchEvent(new CustomEvent(REPLAY_TOUR, { detail: id }));
