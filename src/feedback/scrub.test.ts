// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the address.
// Every secret here is made up (hunter2 style).
import { expect, test } from "vitest";
import { scrub } from "./scrub";

test("app037: file paths of every kind are replaced, the words around them stay", () => {
  // a path under a user profile folder takes the rest of its line (FIX-1), so those stand last on a line
  const text = "crash in D:\\work\\proj\\src\\a.ts and ~/notes/y.md plus \\\\srv\\share\\f.txt and /opt/tool/bin/x done\nlast in C:\\Users\\me\\proj\\a.ts\nthen /home/me/work/x.rs";
  const out = scrub(text);
  for (const gone of ["D:\\work", "proj\\src", "C:\\Users", "me\\proj", "/home/me", "work/x.rs", "~/notes", "y.md", "\\\\srv", "f.txt", "/opt/tool"]) expect(out, gone).not.toContain(gone);
  expect(out).toBe("crash in [path] and [path] plus [path] and [path] done\nlast in [path]\nthen [path]");
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

// FIX-1 (council review of 9b6e5841, FIX-BEFORE 1): every probe the reviewer ran. All names and
// secrets here are made up.
test("fix1: a user folder with a space in its name never leaks, nor the folders after it", () => {
  const out = scrub("see C:\\Users\\Jane Doe\\AppData\\Roaming\\app\\log.txt");
  expect(out).toBe("see [path]");
  const cloud = scrub("saved in C:\\Users\\Jane Doe\\OneDrive - Contoso Ltd\\Desktop\\plan.docx");
  for (const gone of ["Jane", "Doe", "Contoso", "plan.docx"]) expect(cloud, gone).not.toContain(gone);
  const lin = scrub("opened /home/jane doe/projects/my app/main.rs\nand /Users/Jane Doe/Library/x");
  for (const gone of ["jane", "Jane", "doe", "Doe", "projects", "Library"]) expect(lin, gone).not.toContain(gone);
});

test("fix1: a quoted or backticked profile path stops at its closing mark, not before it", () => {
  expect(scrub('failed to open "C:\\Users\\Jane Doe\\a b\\c.txt" twice')).toBe('failed to open "[path]" twice');
  expect(scrub("run `/home/jane doe/bin/x` again")).toBe("run `[path]` again");
  const o = scrub("it is 'C:\\Users\\O'Brien\\x.txt' now");
  for (const gone of ["O'Brien", "Brien", "x.txt"]) expect(o, gone).not.toContain(gone);
});

test("fix1: paths after a backtick, a brace, a colon, in a file address and without a drive are replaced", () => {
  const cases: Array<[string, string]> = [
    ["see `C:\\Users\\jane\\proj\\a.ts` here", "jane"],
    ["file:///C:/Users/jane/Desktop/a.txt", "jane"],
    ["opened file:///home/jane/notes/a.txt", "jane"],
    ["error:C:\\Users\\jane\\x", "jane"],
    ["path:/home/jane/x/y", "jane"],
    ["at {C:\\Users\\jane\\x}", "jane"],
    ["\\Users\\jane\\Desktop\\x", "jane"],
    ["in `D:\\work\\secret-project\\a.ts` too", "secret-project"],
    ["{D:\\work\\secret-project\\a.ts}", "secret-project"],
    ["error:D:\\work\\secret-project\\a.ts", "secret-project"],
    ["file:///D:/work/secret-project/a.ts", "secret-project"],
  ];
  for (const [text, leak] of cases) {
    const out = scrub(text);
    expect(out, text).not.toContain(leak);
    expect(out, text).toContain("[path]");
  }
});

test("fix1: addresses on the web and the words that follow them are still left alone", () => {
  for (const keep of ["see https://github.com/TxaisX/kolux/issues/12 for it", "at http://localhost:3000/api/users now", "ws://host:80/a/b and mailto:me@x.org"]) {
    expect(scrub(keep), keep).toBe(keep);
  }
});

test("fix1: private key blocks, live payment keys, GitLab and npm tokens, and password flags are masked", () => {
  const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAFAKEFAKEFAKE\nAAAAFAKEFAKEFAKEFAKE\n-----END OPENSSH PRIVATE KEY-----";
  expect(scrub(`before\n${pem}\nafter`)).toBe("before\n[masked]\nafter");
  const cut = scrub("pasted -----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKE\nand no end");
  expect(cut).not.toContain("MIIFAKE");
  const secrets = ["sk_live_FAKEFAKEFAKE12345678", "rk_live_FAKEFAKEFAKE12345678", "glpat-FAKEFAKEFAKE12345678", "npm_FAKEFAKEFAKEFAKE1234567890", "hunter2", "swordfish"];
  const out = scrub(
    [
      "stripe sk_live_FAKEFAKEFAKE12345678 and rk_live_FAKEFAKEFAKE12345678",
      "gitlab glpat-FAKEFAKEFAKE12345678",
      "npm_FAKEFAKEFAKEFAKE1234567890",
      "tool --password hunter2 --user me",
      "tool --token swordfish",
      'tool --password "hunter2"',
      "pass: hunter2",
    ].join("\n"),
  );
  for (const s of secrets) expect(out, s).not.toContain(s);
  expect(out).toContain("--user me");
  expect(out).toContain("--password [masked]");
  expect(out).toContain("pass: [masked]");
  // ordinary words that only start like these stay
  for (const keep of ["npm_config_registry is unset", "the test passed: yes", "--passwords are fine", "a --token-count of five", "run --password --verbose"]) expect(scrub(keep), keep).toBe(keep);
});

test("fix1: the new rules are idempotent too", () => {
  const messy = "see C:\\Users\\Jane Doe\\x.txt\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\ntool --password hunter2 `D:\\w\\a.ts` file:///home/jane/x/y glpat-FAKEFAKEFAKE12345678";
  expect(scrub(scrub(messy))).toBe(scrub(messy));
});
