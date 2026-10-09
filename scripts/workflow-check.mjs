// Validates the GitHub Actions workflows in .github/workflows against the parts of the workflow
// schema they use, plus the APP-059/APP-060 promises: CI runs four shards and reports one result,
// and the release workflow passes the CI gate before the release job.
//   node scripts/workflow-check.mjs [files...]       exit 0 = OK, 1 = problems listed
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOP = new Set(["name", "run-name", "on", "permissions", "env", "defaults", "concurrency", "jobs"]);
const EVENTS = new Set(["push", "pull_request", "workflow_dispatch", "workflow_run", "workflow_call", "schedule", "release"]);
const JOB = new Set(["name", "needs", "if", "runs-on", "permissions", "environment", "concurrency", "outputs", "env", "defaults", "steps", "timeout-minutes", "strategy", "continue-on-error", "container", "services", "uses", "with", "secrets"]);
const STEP = new Set(["id", "if", "name", "uses", "run", "working-directory", "shell", "with", "env", "continue-on-error", "timeout-minutes"]);
const SHELLS = new Set(["bash", "pwsh", "powershell", "cmd", "sh", "python"]);
const INPUT_TYPES = new Set(["boolean", "choice", "number", "environment", "string"]);

export function checkWorkflow(text, file = "workflow") {
  const errs = [];
  const err = (m) => errs.push(`${file}: ${m}`);
  let doc;
  try {
    doc = parse(text, { uniqueKeys: true, strict: true });
  } catch (e) {
    return [`${file}: not valid YAML: ${e.message.split("\n")[0]}`];
  }
  if (!doc || typeof doc !== "object") return [`${file}: empty workflow`];
  // Every ${{ }} closes on its own line.
  for (const [n, line] of text.split("\n").entries()) if ((line.match(/\$\{\{/g) ?? []).length !== (line.match(/\}\}/g) ?? []).length) err(`line ${n + 1}: an expression is not closed`);
  for (const k of Object.keys(doc)) if (!TOP.has(k)) err(`unknown top-level key "${k}"`);
  if (typeof doc.name !== "string") err("needs a name");
  const on = doc.on;
  const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : on && typeof on === "object" ? Object.keys(on) : [];
  if (!events.length) err('needs at least one trigger under "on"');
  for (const e of events) if (!EVENTS.has(e)) err(`unknown trigger "${e}"`);
  const inputs = on?.workflow_dispatch?.inputs ?? {};
  for (const [k, v] of Object.entries(inputs)) if (v?.type && !INPUT_TYPES.has(v.type)) err(`input ${k} has unknown type ${v.type}`);

  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== "object" || !Object.keys(jobs).length) return [...errs, `${file}: needs at least one job`];
  for (const [id, job] of Object.entries(jobs)) {
    if (!/^[A-Za-z_][\w-]*$/.test(id)) err(`job id "${id}" is not allowed`);
    for (const k of Object.keys(job)) if (!JOB.has(k)) err(`job ${id}: unknown key "${k}"`);
    if (!job["runs-on"] && !job.uses) err(`job ${id}: needs runs-on`);
    const needs = job.needs === undefined ? [] : [].concat(job.needs);
    for (const n of needs) if (!(n in jobs)) err(`job ${id}: needs "${n}", which is not a job`);
    const matrix = job.strategy?.matrix ?? {};
    if (!job.uses && (!Array.isArray(job.steps) || !job.steps.length)) err(`job ${id}: needs steps`);
    (job.steps ?? []).forEach((s, i) => {
      const at = `job ${id} step ${i + 1}${s?.name ? ` (${s.name})` : ""}`;
      if (!s || typeof s !== "object") return err(`${at}: not a mapping`);
      for (const k of Object.keys(s)) if (!STEP.has(k)) err(`${at}: unknown key "${k}"`);
      if (!!s.run === !!s.uses) err(`${at}: needs exactly one of run or uses`);
      if (s.uses && !/^[\w.-]+\/[\w./-]+@[\w.-]+$/.test(s.uses)) err(`${at}: uses "${s.uses}" must name owner/repo@version`);
      if (s.shell && !SHELLS.has(s.shell)) err(`${at}: unknown shell ${s.shell}`);
      if (s.with && s.run) err(`${at}: with only goes with uses`);
    });
    // Matrix values and job results an expression reads exist.
    const body = JSON.stringify(job);
    for (const m of body.matchAll(/matrix\.([\w-]+)/g)) if (!(m[1] in matrix)) err(`job ${id}: reads matrix.${m[1]}, which the matrix does not define`);
    for (const m of body.matchAll(/needs\.([\w-]+)\./g)) if (!needs.includes(m[1])) err(`job ${id}: reads needs.${m[1]} without needing it`);
  }
  return errs;
}

/** APP-060 and APP-059 promises on top of the schema. */
export function checkPromises(docs) {
  const errs = [];
  const ci = docs["ci.yml"];
  if (!ci) errs.push("ci.yml is missing");
  else {
    const shards = ci.jobs?.test?.strategy?.matrix?.shard;
    if (JSON.stringify(shards) !== "[1,2,3,4]") errs.push("ci.yml: the test job must run shards 1, 2, 3 and 4");
    if (!JSON.stringify(ci.jobs?.test?.steps ?? []).includes("--shard=${{ matrix.shard }}/4")) errs.push("ci.yml: the tests must be split with --shard=<n>/4");
    if (ci.jobs?.test?.strategy?.["fail-fast"] !== false) errs.push("ci.yml: fail-fast must be off so every shard reports");
    const result = Object.values(ci.jobs ?? {}).find((j) => [].concat(j.needs ?? []).includes("test"));
    if (!result || result.if !== "always()") errs.push("ci.yml: one result job must need the shards and always run");
    if (!("push" in (ci.on ?? {})) || !("workflow_dispatch" in (ci.on ?? {}))) errs.push("ci.yml: must run on push to main and by hand for a pushed branch");
  }
  const rel = docs["release.yml"];
  if (!rel) errs.push("release.yml is missing");
  else {
    const steps = Object.values(rel.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const gate = steps.findIndex((s) => String(s.run ?? "").includes("scripts/ci-gate.mjs"));
    const job = steps.findIndex((s) => String(s.run ?? "").includes("scripts/release.mjs"));
    if (gate < 0) errs.push("release.yml: must run scripts/ci-gate.mjs");
    if (job < 0) errs.push("release.yml: must run scripts/release.mjs");
    if (gate >= 0 && job >= 0 && gate > job) errs.push("release.yml: the CI gate must come before the release job");
  }
  return errs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = path.join(ROOT, ".github", "workflows");
  const files = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join(dir, f));
  const errs = [];
  const docs = {};
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    errs.push(...checkWorkflow(text, path.basename(f)));
    try {
      docs[path.basename(f)] = parse(text);
    } catch {
      /* reported above */
    }
  }
  if (process.argv.length <= 2) errs.push(...checkPromises(docs));
  for (const e of errs) console.error(e);
  console.log(`workflow-check: ${files.length} workflows, ${errs.length} problem(s)`);
  console.log(errs.length ? "workflow-check: FAILED" : "workflow-check: OK");
  process.exit(errs.length ? 1 : 0);
}
