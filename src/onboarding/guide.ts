// ONB-014 Setup Guide, ONB-017 its CLI step, ONB-022 Explore Kolux and ONB-027 startup tips: the
// model behind the dialogs in Guides.tsx. The window opens them through the events below, so the
// help menu, a tip or any other caller can ask for a guide without passing state around.
// ponytail: only the CLI step ticks from real state here; the other steps tick in T-321 (ONB-015).
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";

export type StepId = "browser" | "notifications" | "agent" | "cli" | "integrations" | "multitask" | "automate" | "repos";
type Words = { name: string; about: string };
export type Step = { id: StepId; group: "setup" | "parallel"; core: boolean; en: Words; ko: Words };

/** The eight steps: the Setup group first, then the numbered parallel-work group. Connect
 *  integrations and the browser are optional, so they never keep Milestones in the help menu. */
export const STEPS: Step[] = [
  { id: "notifications", group: "setup", core: true, en: { name: "Turn on notifications", about: "Hear when an agent finishes or needs you, even with Kolux in the background." }, ko: { name: "알림 켜기", about: "Kolux가 백그라운드에 있어도 에이전트가 끝나거나 도움이 필요할 때 알려 줍니다." } },
  { id: "agent", group: "setup", core: true, en: { name: "Choose a default agent", about: "Pick the AI that starts when you open a new session." }, ko: { name: "기본 에이전트 선택", about: "새 세션을 열 때 시작할 AI를 고릅니다." } },
  { id: "cli", group: "setup", core: true, en: { name: "Enable Kolux CLI", about: "Let your agents drive Kolux: open terminals, run orchestration and read the skills that teach them how." }, ko: { name: "Kolux CLI 사용", about: "에이전트가 Kolux를 직접 다루게 합니다: 터미널 열기, 오케스트레이션 실행, 사용법을 알려 주는 스킬 읽기." } },
  { id: "browser", group: "setup", core: false, en: { name: "Use Kolux's browser", about: "Open web pages beside your terminals so an agent's work and its preview sit together." }, ko: { name: "Kolux 브라우저 사용", about: "터미널 옆에서 웹 페이지를 열어 에이전트의 작업과 미리보기를 함께 봅니다." } },
  { id: "integrations", group: "setup", core: false, en: { name: "Connect integrations", about: "Bring in GitHub reviews and tasks so work arrives where you run it." }, ko: { name: "통합 연결", about: "GitHub 리뷰와 작업을 가져와 일하는 곳에서 바로 받습니다." } },
  { id: "multitask", group: "parallel", core: true, en: { name: "Multi-task", about: "Run more than one agent at once, each in its own pane." }, ko: { name: "멀티태스킹", about: "여러 에이전트를 각자의 창에서 동시에 실행합니다." } },
  { id: "automate", group: "parallel", core: true, en: { name: "Automate workspace setup", about: "Have each new workspace install and prepare itself before an agent starts." }, ko: { name: "작업 공간 설정 자동화", about: "새 작업 공간마다 에이전트가 시작하기 전에 스스로 설치하고 준비하게 합니다." } },
  { id: "repos", group: "parallel", core: true, en: { name: "Start work in multiple repos", about: "Add a second project and keep agents busy in both." }, ko: { name: "여러 저장소에서 작업 시작", about: "두 번째 프로젝트를 추가하고 두 곳 모두에서 에이전트를 일하게 합니다." } },
];

/** A step's name and description in the interface language (English unless it is Korean). */
export const words = (s: Step): Words => (locale() === "ko" ? s.ko : s.en);

/** The step the guide opens on: the one asked for, else the first unfinished one (Setup first,
 *  then parallel work, which is the list's own order), else the first step. */
export function firstOpen(done: ReadonlySet<StepId>, ask?: StepId | null): StepId {
  if (ask && STEPS.some((s) => s.id === ask)) return ask;
  return (STEPS.find((s) => !done.has(s.id)) ?? STEPS[0]).id;
}

/** Once the step showing is done, the guide moves to the next unfinished one after it (or the
 *  first unfinished from the top); with everything done it stays. */
export function moveOn(at: StepId, done: ReadonlySet<StepId>): StepId {
  if (!done.has(at)) return at;
  const i = STEPS.findIndex((s) => s.id === at);
  const next = [...STEPS.slice(i + 1), ...STEPS.slice(0, i)].find((s) => !done.has(s.id));
  return next ? next.id : at;
}

/** The ring: core steps done out of all core steps. */
export function ring(done: ReadonlySet<StepId>): { done: number; total: number } {
  const core = STEPS.filter((s) => s.core);
  return { done: core.filter((s) => done.has(s.id)).length, total: core.length };
}

/** Milestones stays in the help menu only while a core step remains. */
export const milestonesShown = (done: ReadonlySet<StepId>) => ring(done).done < ring(done).total;

// ---- ONB-017: the CLI step's capabilities ----

export type CliStatus = { installed: boolean; onPath: boolean };
export type CapId = "command" | "kolux-cli" | "orchestration";
export type Cap = { id: CapId; label: string; about: string; ready: boolean };

/** What the CLI step sets up and whether each is in place: the command in outside terminals, and
 *  the two Kolux skills found in an agent's own skills folder (bundled copies do not count). */
export function caps(cli: CliStatus | null, homeSkills: readonly string[]): Cap[] {
  return [
    { id: "command", label: "Kolux CLI", about: "The kolux command in terminals outside Kolux, so any agent can call it.", ready: !!cli?.installed && !!cli.onPath },
    { id: "kolux-cli", label: "Kolux CLI skill", about: "Teaches your agents every kolux command.", ready: homeSkills.includes("kolux-cli") },
    { id: "orchestration", label: "Orchestration skill", about: "Lets one agent hand work to others and wait for their results.", ready: homeSkills.includes("orchestration") },
  ];
}

/** Missing capabilities start ticked, ready ones unticked. */
export const startTicked = (c: readonly Cap[]): CapId[] => c.filter((x) => !x.ready).map((x) => x.id);

// ---- ONB-022: Explore Kolux ----

export type Stop = { id: string; title: string; caption: string; optional?: boolean };
export type Workflow = Stop & { stops: Stop[] };

export const WORKFLOWS: Workflow[] = [
  { id: "workspaces", title: "Workspaces", caption: "Each workspace is its own copy of a project, so agents can work side by side without stepping on each other.", stops: [] },
  { id: "tasks", title: "Tasks", caption: "Tasks gather what needs doing: from GitHub, from your notes or typed in. Start an agent on any of them with one click, and its progress shows on the task.", stops: [] },
  {
    id: "agents",
    title: "Agents",
    caption: "Run Claude Code, Codex and Grok in panes beside each other and see at a glance which one needs you.",
    stops: [
      { id: "statuses", title: "Statuses", caption: "Every pane says whether its agent is working, done or waiting for you, and the sidebar sums it up." },
      { id: "usage", title: "Usage", caption: "See how much of each plan's limit is left and what your sessions cost.", optional: true },
      { id: "orchestration", title: "Orchestration", caption: "One agent splits a job, hands the parts to others and gathers their results.", optional: true },
    ],
  },
  {
    id: "workbench",
    title: "Workbench",
    caption: "Everything an agent's work needs sits in one window.",
    stops: [
      { id: "terminal", title: "Terminal", caption: "Terminals in a grid of one, two, four or six panes." },
      { id: "editor", title: "Editor", caption: "Open and edit the files an agent touched without leaving Kolux." },
      { id: "browser", title: "Browser", caption: "Preview what was built in a browser tab beside the terminal.", optional: true },
    ],
  },
  {
    id: "review",
    title: "Review",
    caption: "Check the work before it ships.",
    stops: [
      { id: "notes", title: "Notes", caption: "Leave notes on lines of a change for the agent to act on." },
      { id: "pr", title: "PR view", caption: "Read a pull request's changes and checks in one place.", optional: true },
      { id: "ship", title: "Ship", caption: "Commit, push and open the pull request when it is ready.", optional: true },
    ],
  },
];

/** Where the tour is: a workflow, and one of its stops (-1 is the workflow's own page). */
export type At = { w: number; s: number };
export const stopOf = (at: At): Stop => (at.s < 0 ? WORKFLOWS[at.w] : WORKFLOWS[at.w].stops[at.s]);

/** Continue: a workflow's stops come before the next workflow; null past the last one. */
export function forward(at: At): At | null {
  if (at.s + 1 < WORKFLOWS[at.w].stops.length) return { w: at.w, s: at.s + 1 };
  return at.w + 1 < WORKFLOWS.length ? { w: at.w + 1, s: -1 } : null;
}

/** The rail's keys: up and down move one workflow, Home and End jump, and it stops at both ends. */
export function railKey(key: string, w: number): number | null {
  const last = WORKFLOWS.length - 1;
  if (key === "ArrowUp") return Math.max(0, w - 1);
  if (key === "ArrowDown") return Math.min(last, w + 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

/** A workflow is Completed once it and each of its stops that is not optional were visited (or,
 *  for usage, the feature was tried: USAGE 012). */
export function completed(wf: Workflow, seen: ReadonlySet<string>): boolean {
  return seen.has(wf.id) && wf.stops.every((s) => s.optional || seen.has(s.id));
}

// ---- ONB-027: startup tips ----

export type TipId = "cli" | "palette";
/** Newest first: the CLI tip, then the command-palette tip. */
export const TIP_ORDER: TipId[] = ["cli", "palette"];

/** The one tip this launch shows, or none. `cli` is "error" when its status could not be read, which
 *  counts as installed. No tip in a session that showed the first-run wizard. */
export function nextTip(o: { seen: readonly string[]; tried: readonly string[]; cli: CliStatus | "error"; onboarding: boolean }): TipId | null {
  if (o.onboarding) return null;
  const done = (t: TipId) => (t === "cli" ? o.cli === "error" || (o.cli.installed && o.cli.onPath) : o.tried.includes("palette"));
  return TIP_ORDER.find((t) => !o.seen.includes(t) && !o.tried.includes(t) && !done(t)) ?? null;
}

// ---- opening the guides from anywhere ----

export const OPEN_GUIDE = "kolux-open-guide";
export const OPEN_EXPLORE = "kolux-open-explore";
/** Opens the Setup Guide, on `step` when given. */
export const openGuide = (step?: StepId) => window.dispatchEvent(new CustomEvent(OPEN_GUIDE, { detail: step ?? null }));
export const openExplore = () => window.dispatchEvent(new CustomEvent(OPEN_EXPLORE));

/** What the guides remember on this profile (onboarding.rs guide_get). */
export type GuideRecord = { tipsSeen: string[]; visited: string[]; tried: string[]; toursSeen: string[]; toursAuto: boolean | null };
/** Adds the id once to one of the record's lists; the stored record comes back. */
export const markGuide = (list: "tipsSeen" | "visited" | "tried" | "toursSeen", id: string) => invoke<GuideRecord>("guide_mark", { list, id });
