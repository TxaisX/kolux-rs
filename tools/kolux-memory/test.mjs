// Tests for the local memory builder. Each test builds a tiny fake machine:
// a session store, a repo with spec/evidence/docs, and a vault. Nothing here
// reads the real profile, so it runs anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, openDb, resumeMarkdown, search, status } from "./lib.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kolux-memory-test-"));
  const sessions = join(root, "sessions.db");
  const db = new DatabaseSync(sessions);
  db.exec(`
    create table session_v2(id text, parent_id text, title text, directory text, agent text, model text, time_created integer, time_updated integer, cost real, tokens_input integer, tokens_output integer);
    create table session_message(id text, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
  `);
  const t = Date.UTC(2026, 9, 31, 10, 0, 0);
  const s = db.prepare("insert into session_v2 values (?,?,?,?,?,?,?,?,?,?,?)");
  s.run("s1", null, "Fix the first load bundle", "G:/work", "build", JSON.stringify({ id: "deepseek/test", providerID: "openrouter" }), t, t + 1000, 0.02, 10, 20);
  s.run("s2", null, "Second session", "G:/work", "explore", JSON.stringify({ id: "claude/test", providerID: "anthropic" }), t + 5000, t + 6000, 0.01, 5, 6);
  const m = db.prepare("insert into session_message values (?,?,?,?,?,?,?)");
  m.run("m1", "s1", "user", 1, t, t, JSON.stringify({ time: { created: t }, text: `Fix the first load bundle. api_key=${"sk-" + "abcdefghijklmnopqrstuvwx"}` }));
  m.run("m2", "s1", "assistant", 2, t + 100, t + 100, JSON.stringify({
    time: { created: t + 100 },
    content: [
      { type: "text", text: "Moved CodeMirror out of buffers." },
      { type: "tool", name: "shell", state: { status: "completed", input: { command: "pnpm test" }, content: [{ type: "text", text: "ok" }] } },
    ],
  }));
  m.run("m3", "s2", "assistant", 3, t + 5000, t + 5000, JSON.stringify({ time: { created: t + 5000 }, content: [{ type: "text", text: "Looked at the spec." }] }));
  m.run("m4", "s2", "compaction", 4, t + 5100, t + 5100, JSON.stringify({ time: { created: t + 5100 }, text: "ignored" }));
  db.close();

  const repo = join(root, "repo");
  mkdirSync(join(repo, "spec"), { recursive: true });
  mkdirSync(join(repo, "evidence"), { recursive: true });
  mkdirSync(join(repo, "docs", "history"), { recursive: true });
  writeFileSync(join(repo, "spec", "01-test.md"), `# Area\n\n### APP-001 · First test card\nTier: P0\nAcceptance:\n  - [ ] one\n  - [x] two\n\n### APP-002 · Struck card\nTier: P0\nAcceptance:\n  - [ ] one\n`);
  writeFileSync(join(repo, "DECISIONS.md"), `| DT-X | row | strikes APP-002 box 1 | | 2026-10-31 | confirmed by Txais 2026-10-31 |\n`);
  writeFileSync(join(repo, "evidence", "APP-001.txt"), `APP-001 test\nRESULT: FAIL\n`);
  writeFileSync(join(repo, "evidence", "live-b7.txt"), `LIVE CHECK b7\nBROW-008 box 2\nRESULT: FAIL\n`);
  writeFileSync(join(repo, "docs", "history", "test.md"), `# Test history\n\nSomething about first load.\n`);

  const vault = join(root, "vault");
  mkdirSync(join(vault, "06 - Projects", "Kolux"), { recursive: true });
  mkdirSync(join(vault, ".kolux", "handoffs"), { recursive: true });
  writeFileSync(join(vault, "06 - Projects", "Kolux", "Kolux.md"), `# Kolux\n\nProject note.\n`);
  writeFileSync(join(vault, ".kolux", "handoffs", "seat-1.md"), `# Handoff\n\nBody.\n`);

  return { root, sessions, repo, vault, db: join(root, "memory.db") };
}

test("builds sessions, redacts secrets, and keeps tool calls", () => {
  const f = fixture();
  try {
    const res = build({ sessions: f.sessions, repo: f.repo, vault: f.vault, db: f.db, github: false, git: false });
    assert.equal(res.counts.sessions, 2);
    assert.equal(res.counts.tools, 1);
    assert.equal(res.counts.handoffs, 1);

    const db = openDb(f.db);
    const user = db.prepare("select text from messages where role='user'").get();
    assert.match(user.text, /\[redacted\]/);
    assert.doesNotMatch(user.text, /sk-abcdef/);
    const tool = db.prepare("select tool, status, input from tools").get();
    assert.equal(tool.tool, "shell");
    assert.equal(tool.status, "completed");
    assert.match(tool.input, /pnpm test/);
    db.close();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("cards reflect strikes and evidence maps a card from line 2", () => {
  const f = fixture();
  try {
    build({ sessions: f.sessions, repo: f.repo, vault: f.vault, db: f.db, github: false, git: false });
    const db = openDb(f.db);
    const one = db.prepare("select * from cards where id='APP-001'").get();
    const two = db.prepare("select * from cards where id='APP-002'").get();
    assert.equal(one.status, "open");
    assert.equal(one.done, 1);
    assert.equal(two.status, "pass");
    assert.equal(two.done, 1);
    const b7 = db.prepare("select card, status from evidence where path like '%live-b7%'").get();
    assert.equal(b7.card, "BROW-008");
    assert.equal(b7.status, "fail");
    const st = status(db, f.db);
    assert.equal(st.p0_pass, 1);
    assert.equal(st.p0_open, 1);
    assert.equal(st.evidence_fail, 2);
    db.close();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("search and resume find the work", () => {
  const f = fixture();
  try {
    build({ sessions: f.sessions, repo: f.repo, vault: f.vault, db: f.db, github: false, git: false });
    const db = openDb(f.db);
    const hits = search(db, "CodeMirror");
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.kind === "message"));
    const md = resumeMarkdown(db, f.db);
    assert.match(md, /APP-001/);
    assert.match(md, /P0 cards: \*\*1\/2\*\*/);
    assert.match(md, /Failures on open cards/);
    db.close();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a missing source does not crash the build", () => {
  const f = fixture();
  try {
    const res = build({ sessions: join(f.root, "nope.db"), repo: f.repo, vault: join(f.root, "novault"), db: f.db, github: false, git: false });
    assert.equal(res.counts.sessions, 0);
    assert.ok(res.counts.cards >= 2);
    const db = openDb(f.db);
    assert.equal(status(db, f.db).sessions, 0);
    db.close();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
