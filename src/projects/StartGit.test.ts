import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import StartGit, { defaultChosen, firstCommitLine, type FirstFile } from "./StartGit";

const files: FirstFile[] = [
  { path: ".env", secret: true },
  { path: "README.md", secret: false },
  { path: "src/main.rs", secret: false },
];
const noop = () => {};

test("the first commit leaves secret-looking files out by default and says so", () => {
  const chosen = defaultChosen(files);
  expect([...chosen]).toEqual(["README.md", "src/main.rs"]);
  expect(firstCommitLine(files, chosen)).toBe("2 files in the first commit, 1 left out.");
  expect(firstCommitLine(files.slice(1, 2), defaultChosen(files.slice(1, 2)))).toBe("1 file in the first commit.");
  const html = renderToString(createElement(StartGit, { folder: "G:\work\site", files, busy: false, onStart: noop, onCancel: noop }));
  expect(html).toContain("Start Git in this folder?");
  expect(html).toContain("Start Git and commit");
  expect(html).toMatch(/<input type="checkbox"\/><span class="first-path">\.env<\/span><span class="first-secret">looks like a secret, left out<\/span>/);
  expect(html).toMatch(/<input type="checkbox" checked=""\/><span class="first-path">README\.md/);
});

test("an empty folder is said to get an empty first commit", () => {
  const html = renderToString(createElement(StartGit, { folder: "G:\empty", files: [], busy: false, onStart: noop, onCancel: noop }));
  expect(html).toContain("the first commit will be empty");
  expect(html).toContain("0 files in the first commit.");
});
