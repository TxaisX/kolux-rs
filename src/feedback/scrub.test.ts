// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the address.
// Every secret here is made up (hunter2 style).
import { expect, test } from "vitest";
import { scrub } from "./scrub";

test("app037: file paths of every kind are replaced, the words around them stay", () => {
  const text = "crash in C:\\Users\\me\\proj\\src\\a.ts and /home/me/work/x.rs plus ~/notes/y.md and \\\\srv\\share\\f.txt done";
  const out = scrub(text);
  for (const gone of ["C:\\Users", "me\\proj", "/home/me", "work/x.rs", "~/notes", "y.md", "\\\\srv", "f.txt"]) expect(out, gone).not.toContain(gone);
  expect(out).toContain("crash in [path] and [path] plus [path] and [path] done");
});

test("app037: ordinary text, web addresses and slash commands are not mistaken for paths", () => {
  for (const keep of [
    "The pane froze after a resize",
    "use and/or here",
    "type /clear to start over",
    "see https://github.com/TxaisX/kolux/issues/12 for it",
    "a ratio of 3/4 and 12/05",
  ]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

test("app037: secrets are masked by shape, by key name and inside addresses", () => {
  const secrets = [
    "sk-ant-api03-FAKEFAKEFAKE1234567890",
    "ghp_FAKEFAKEFAKEFAKE1234567890",
    "github_pat_FAKEFAKEFAKE1234567890",
    "xoxb-FAKE-1234567890-abcdef",
    "AKIAFAKEFAKEFAKE1234",
    "eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoxfQ.FAKESIGNATURE12345",
    "hunter2",
    "correcthorse",
  ];
  const text = [
    "key sk-ant-api03-FAKEFAKEFAKE1234567890",
    "gh ghp_FAKEFAKEFAKEFAKE1234567890 and github_pat_FAKEFAKEFAKE1234567890",
    "slack xoxb-FAKE-1234567890-abcdef aws AKIAFAKEFAKEFAKE1234",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoxfQ.FAKESIGNATURE12345",
    "password: hunter2",
    "token=hunter2",
    'config {"api_key": "hunter2"}',
    "ANTHROPIC_API_KEY=hunter2",
    "Authorization: Bearer abcdefghijklmnop",
    "git clone https://me:hunter2@github.com/me/repo.git",
    "my password is correcthorse",
  ].join("\n");
  const out = scrub(text);
  for (const s of secrets) expect(out, s).not.toContain(s);
  expect(out).not.toContain("abcdefghijklmnop");
  expect(out).toContain("github.com/me/repo.git"); // the rest of the address stays
  expect(out).toContain("[masked]");
});

test("app037: words that merely contain a key name are left alone, and scrubbing twice changes nothing", () => {
  expect(scrub("monkey: banana")).toBe("monkey: banana");
  expect(scrub("the token ring network")).toBe("the token ring network");
  const messy = "C:\\Users\\me\\a.ts password=hunter2 /home/me/x/y ghp_FAKEFAKEFAKEFAKE1234567890 Bearer abcdefghijklmnop";
  expect(scrub(scrub(messy))).toBe(scrub(messy));
});

test("app037: line endings are kept as typed", () => {
  expect(scrub("one\r\ntwo\r\n\r\nthree")).toBe("one\r\ntwo\r\n\r\nthree");
});
