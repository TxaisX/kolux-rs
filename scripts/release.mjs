// APP-059: the release job. Builds main in a checkout kept only for releases, one build at a time,
// gives it the next patch version, signs the installer, smoke-tests the result and publishes the
// installer, its signature and the update manifest (latest.json) with notes listing the shipped
// commits. `pnpm ship --main` starts it in the background; it can also be run by hand.
//
//   pnpm release [--dry-run] [--no-publish] [--repo <url>]
//
//   --dry-run      print the version, the notes and the steps; build and publish nothing
//   --no-publish   build, sign and smoke-test, then stop (the files stay in <checkout>-out)
//
// Environment: KOLUX_RELEASE_CHECKOUT  the build checkout (default ~/.kolux-rs/release-checkout)
//              KOLUX_RELEASE_KEY       the signing key file, its public half beside it as .pub
//                                      (default ~/.kolux-rs/release-signing/kolux-rs.key)
//              KOLUX_RELEASE_KEY_PASSWORD  the key's password, when it has one
//              KOLUX_RELEASE_PUBLISH_DIR   publish into this folder instead of GitHub (rehearsal)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FEED_REPO = "TxaisX/kolux-rs-releases";
export const NOTES_MAX = 30;
export const STALE_MS = 3 * 60 * 60 * 1000;
const MARKER = /<!-- kolux-rs-source: ([0-9a-f]{7,40}) -->/;

export const checkoutDir = (env = process.env) => path.resolve(env.KOLUX_RELEASE_CHECKOUT || path.join(os.homedir(), ".kolux-rs", "release-checkout"));
export const logDir = (env = process.env) => checkoutDir(env) + "-logs";
const keyFile = (env) => path.resolve(env.KOLUX_RELEASE_KEY || path.join(os.homedir(), ".kolux-rs", "release-signing", "kolux-rs.key"));

// ------------------------------------------------------------------ pure rules (tested)

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One patch above whichever is higher: the project's version or the newest release. */
export function nextVersion(projectVersion, latestTag) {
  const p = parse(projectVersion);
  if (!p) throw new Error(`the project version "${projectVersion}" is not x.y.z`);
  const l = parse(latestTag);
  const base = l && cmp(l, p) > 0 ? l : p;
  return `${base[0]}.${base[1]}.${base[2] + 1}`;
}

/** The release notes: each commit subject since the last release, 30 at most, then the hidden marker. */
export function notesBody(subjects, sha) {
  const lines = subjects.filter((s) => s.trim()).slice(0, NOTES_MAX).map((s) => `- ${s.trim()}`);
  return `${lines.join("\n")}\n\n<!-- kolux-rs-source: ${sha} -->\n`;
}
export const markerOf = (body) => MARKER.exec(body ?? "")?.[1] ?? null;

/** A build lock older than three hours, or held by a process that has died, is stale. */
export const isStale = (lock, now, alive) => !lock || now - lock.at > STALE_MS || !alive(lock.pid);

export function manifest(version, notes, signature, url, now = new Date()) {
  return { version, notes, pub_date: now.toISOString(), platforms: { "windows-x86_64": { signature, url } } };
}
/** APP-061: the packaged command line reports the release version and its help works. `cli` runs it
 *  with the given words and returns what it printed; a mismatch throws, which stops the release. */
export function smokeCli(cli, version) {
  const said = cli(["--version"]);
  if (said !== version) throw new Error(`smoke test: kolux --version says ${said}, the release is ${version}`);
  const help = cli(["--help"]);
  if (!help.includes("--version") || !help.includes("worktree")) throw new Error("smoke test: kolux --help did not print the command list");
}

export const installerName = (version) => `Kolux RS_${version}_x64-setup.exe`;
export const downloadUrl = (version) => `https://github.com/${FEED_REPO}/releases/download/v${version}/${encodeURIComponent(installerName(version))}`;
export const isGitHub = (repo) => /^(https:\/\/github\.com\/|git@github\.com:)/.test(repo ?? "");

/** Picks the newest `v<x.y.z>` folder of a rehearsal publish folder. */
export function newestTag(names) {
  return names.filter((n) => parse(n)).sort((a, b) => cmp(parse(b), parse(a)))[0] ?? null;
}

// ------------------------------------------------------------------ the lock and the queue

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Takes the build lock, or leaves a queue mark for the build that holds it. */
export function acquire(dir, { now = Date.now(), pid = process.pid, isAlive = alive } = {}) {
  const lockPath = dir + ".lock";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid, at: now }), { flag: "wx" });
      return "locked";
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let lock = null;
      try {
        lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      } catch {
        /* unreadable counts as stale */
      }
      if (!isStale(lock, now, isAlive)) {
        // One more build from the newest main, however many ships land meanwhile.
        fs.writeFileSync(dir + ".queued", String(now));
        // ponytail: the holder may have finished between our two looks; a few-ms window, rerun the job if it ever bites.
        if (fs.existsSync(lockPath)) return "queued";
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  return "queued";
}
/** True (and the mark is cleared) when a ship landed during the build. */
export function takeQueued(dir) {
  try {
    fs.rmSync(dir + ".queued");
    return true;
  } catch {
    return false;
  }
}
export const unlock = (dir) => fs.rmSync(dir + ".lock", { force: true });

// ------------------------------------------------------------------ the job

const say = (...a) => console.log(new Date().toISOString(), ...a);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: opts.shell ?? false, cwd: opts.cwd, env: opts.env ?? process.env, maxBuffer: 1 << 28 });
  if (opts.echo) process.stdout.write((r.stdout || "") + (r.stderr || ""));
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.error?.message}):\n${(r.stderr || r.stdout || "").trim().slice(-2000)}`);
  return (r.stdout || "").trim();
}
const git = (dir, ...args) => sh("git", ["-C", dir, ...args]);
// pnpm and cargo are .cmd shims on Windows, which only start through the shell; every argument here is ours.
// One command string, so node does not warn about unescaped arguments.
const tool = (cmd, args, opts) => (process.platform === "win32" ? sh([cmd, ...args].join(" "), [], { ...opts, shell: true }) : sh(cmd, args, opts));

function latestRelease(env, repo) {
  if (env.KOLUX_RELEASE_PUBLISH_DIR) {
    const pub = path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR);
    const tag = fs.existsSync(pub) ? newestTag(fs.readdirSync(pub)) : null;
    return tag ? { tag, body: fs.readFileSync(path.join(pub, tag, "notes.md"), "utf8") } : null;
  }
  if (!onGitHub(repo, env)) return null;
  const r = spawnSync("gh", ["release", "view", "--repo", FEED_REPO, "--json", "tagName,body"], { encoding: "utf8" });
  if (r.status !== 0) return null; // no release yet
  const j = JSON.parse(r.stdout);
  return { tag: j.tagName, body: j.body };
}

function setVersion(dir, version) {
  const edit = (f, fn) => fs.writeFileSync(path.join(dir, f), fn(fs.readFileSync(path.join(dir, f), "utf8")));
  edit("package.json", (s) => s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
  edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
  edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]*"/m, `version = "${version}"`));
}

export function buildOnce(o, env = process.env) {
  const dir = checkoutDir(env);
  // 1. The checkout kept only for releases, at the newest main.
  if (!fs.existsSync(path.join(dir, ".git"))) {
    if (!o.repo) throw new Error(`no build checkout at ${dir} and no --repo to clone it from`);
    say(`cloning ${o.repo} into ${dir}`);
    sh("git", ["clone", "-q", o.repo, dir]);
  } else {
    if (o.repo) git(dir, "remote", "set-url", "origin", o.repo);
    git(dir, "fetch", "-q", "--prune", "origin");
  }
  const repo = o.repo || git(dir, "remote", "get-url", "origin");
  const sha = git(dir, "rev-parse", "origin/main");
  const latest = latestRelease(env, repo);
  if (latest && markerOf(latest.body) === sha) {
    say(`main ${sha.slice(0, 7)} was already released as ${latest.tag}; nothing to do`);
    return null;
  }
  git(dir, "checkout", "-q", "--force", "--detach", sha);
  git(dir, "clean", "-q", "-fdx", "-e", "node_modules", "-e", "src-tauri/target");

  // 2. Version and notes.
  const projectVersion = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const version = nextVersion(projectVersion, latest?.tag);
  const prev = markerOf(latest?.body);
  const known = prev && spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", prev, sha]).status === 0;
  const range = known ? [`${prev}..${sha}`] : [sha, "-n", String(NOTES_MAX)];
  const subjects = git(dir, "log", "--no-merges", "--format=%s", ...range).split("\n");
  const notes = notesBody(subjects, sha);
  say(`release ${version} from main ${sha.slice(0, 7)} (project ${projectVersion}, newest release ${latest?.tag ?? "none"})`);
  console.log(notes);
  if (o.dryRun) {
    say(`dry run: would set version ${version}, run pnpm install and pnpm tauri build --bundles nsis signed with ${keyFile(env)}, smoke-test, then publish ${installerName(version)}, its .sig and latest.json to ${env.KOLUX_RELEASE_PUBLISH_DIR ? path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR) : FEED_REPO}`);
    return { version, sha, notes, dryRun: true };
  }

  // 3. Build and sign.
  const key = keyFile(env);
  if (!fs.existsSync(key) || !fs.existsSync(key + ".pub")) throw new Error(`no signing key at ${key} (and ${key}.pub). Make one once with: pnpm tauri signer generate -w "${key}"`);
  const pubkey = fs.readFileSync(key + ".pub", "utf8").trim();
  setVersion(dir, version);
  const conf = path.join(dir, "src-tauri", "release.conf.json");
  const target = path.resolve(env.CARGO_TARGET_DIR || path.join(dir, "src-tauri", "target"), "release");
  // The bundler checks the signature it makes against the configured public key. CLI-006: the
  // installer carries the command line and its kolux.cmd shim in a bin folder of the install.
  const resources = { [path.join(dir, "src-tauri", "cli", "kolux.cmd").replaceAll("\\", "/")]: "bin/kolux.cmd", [path.join(target, "kolux.exe").replaceAll("\\", "/")]: "bin/kolux.exe" };
  fs.writeFileSync(conf, JSON.stringify({ bundle: { createUpdaterArtifacts: true, resources }, plugins: { updater: { pubkey } } }));
  const benv = { ...env, TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(key, "utf8"), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: env.KOLUX_RELEASE_KEY_PASSWORD ?? "", KOLUX_RS_RELEASE_PUBKEY: pubkey };
  say("installing packages");
  tool("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, env: benv });
  say("building the command line, then the Windows installer that carries it");
  tool("cargo", ["build", "--release", "--features", "release-cli", "--bin", "kolux"], { cwd: path.join(dir, "src-tauri"), env: benv });
  tool("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", `"${conf}"`], { cwd: dir, env: benv, echo: true });

  // 4. Smoke test: the files are there, and the CLI, the app and the manifest agree on the version.
  const exe = path.join(target, "bundle", "nsis", installerName(version));
  if (!fs.existsSync(exe) || fs.statSync(exe).size < 1 << 20) throw new Error(`smoke test: no installer at ${exe}`);
  const signature = fs.existsSync(exe + ".sig") ? fs.readFileSync(exe + ".sig", "utf8").trim() : "";
  if (!signature) throw new Error(`smoke test: the installer has no signature (${exe}.sig)`);
  smokeCli((words) => sh(path.join(target, "kolux.exe"), words), version);
  const appVersion = JSON.parse(fs.readFileSync(path.join(dir, "src-tauri", "tauri.conf.json"), "utf8")).version;
  if (appVersion !== version) throw new Error(`smoke test: the app says ${appVersion}, the release is ${version}`);
  const out = path.join(dir + "-out", `v${version}`);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(exe, path.join(out, installerName(version)));
  fs.copyFileSync(exe + ".sig", path.join(out, installerName(version) + ".sig"));
  const m = manifest(version, notes, signature, downloadUrl(version));
  fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(m, null, 2));
  fs.writeFileSync(path.join(out, "notes.md"), notes);
  say(`smoke test passed: installer, signature, kolux --version and --help, and the manifest all say ${version}`);
  if (o.noPublish) {
    say(`built ${version}, not published; the files are in ${out}`);
    return { version, sha, notes, out, published: false };
  }

  // 5. Publish: the installer, its signature and the manifest.
  if (env.KOLUX_RELEASE_PUBLISH_DIR) {
    const pub = path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR);
    fs.cpSync(out, path.join(pub, `v${version}`), { recursive: true });
    fs.copyFileSync(path.join(out, "latest.json"), path.join(pub, "latest.json"));
    say(`published ${version} to the folder ${pub}`);
  } else {
    if (!onGitHub(repo, env)) throw new Error(`the source repository ${repo} is not on GitHub, so nothing is published; set KOLUX_RELEASE_PUBLISH_DIR to rehearse`);
    // APP-031: the manifest goes up last, so a release is never announced before its installer is there.
    const files = [installerName(version), installerName(version) + ".sig"].map((f) => path.join(out, f));
    sh("gh", ["release", "create", `v${version}`, "--repo", FEED_REPO, "--title", `Kolux RS ${version}`, "--notes-file", path.join(out, "notes.md"), ...files]);
    sh("gh", ["release", "upload", `v${version}`, "--repo", FEED_REPO, path.join(out, "latest.json")]);
    say(`published ${version} to ${FEED_REPO}`);
  }
  return { version, sha, notes, out, published: true };
}

export function run(o, env = process.env) {
  const dir = checkoutDir(env);
  if (o.dryRun) return void buildOnce(o, env);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (acquire(dir) === "queued") return void say("a release build is running; one more build from the newest main is queued after it");
  try {
    do buildOnce(o, env);
    while (takeQueued(dir) && (say("a ship landed during the build; building again from the newest main"), true));
  } finally {
    unlock(dir);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const o = { dryRun: a.includes("--dry-run"), noPublish: a.includes("--no-publish"), repo: a.includes("--repo") ? a[a.indexOf("--repo") + 1] : null };
  try {
    run(o);
  } catch (e) {
    // The failure goes to the log; the ship that started this job has already succeeded.
    say(`release failed: ${e.message}`);
    process.exit(1);
  }
}
