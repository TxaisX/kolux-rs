import { expect, test } from "vitest";
import { initials, insertMention, MAX_REVIEWERS, mentionAt, mentionMatches, requestReviewers } from "./people";

const people = [
  { login: "ana-b", avatar: "" },
  { login: "mo", avatar: "" },
  { login: "banana", avatar: "" },
  { login: "Anders", avatar: "" },
];

test("GIT-053: typing @ and two letters lists the matching people, starts-with first", () => {
  const text = "thanks @an";
  const m = mentionAt(text, text.length);
  expect(m).toEqual({ start: 7, query: "an" });
  expect(mentionMatches(people, m!.query).map((p) => p.login)).toEqual(["ana-b", "Anders", "banana"]);
  expect(mentionMatches(people, "zz")).toEqual([]);
  expect(mentionAt("@", 1), "a lone @ already opens the list").toEqual({ start: 0, query: "" });
});

test("GIT-053: an email address or a finished word is not a mention", () => {
  expect(mentionAt("mail me at a@an", 15)).toBeNull();
  expect(mentionAt("@ana done", 9)).toBeNull();
  expect(mentionAt("(@mo", 4)).toEqual({ start: 1, query: "mo" });
  expect(mentionAt("line\n@mo", 8)).toEqual({ start: 5, query: "mo" });
});

test("GIT-053: picking a person inserts the mention and puts the caret after it", () => {
  expect(insertMention("thanks @an", 7, 10, "ana-b")).toEqual({ text: "thanks @ana-b ", caret: 14 });
  expect(insertMention("cc @m and more", 3, 5, "mo"), "the rest of the text stays").toEqual({ text: "cc @mo and more", caret: 7 });
});

test("GIT-053: a sixteenth reviewer is refused, existing requests are kept and never asked twice", () => {
  const fourteen = Array.from({ length: 14 }, (_, i) => `r${i}`);
  expect(requestReviewers(fourteen, ["new", "R0"])).toEqual({ ok: true, add: ["new"] });
  const fifteen = [...fourteen, "new"];
  expect(fifteen).toHaveLength(MAX_REVIEWERS);
  const refused = requestReviewers(fifteen, ["sixteenth"]);
  expect(refused.ok).toBe(false);
  expect(requestReviewers(fifteen, ["r3"]), "asking an existing reviewer again adds nothing").toEqual({ ok: true, add: [] });
});

test("GIT-053: people without an avatar show initials", () => {
  expect(initials("ana-b")).toBe("AB");
  expect(initials("mo")).toBe("MO");
  expect(initials("emu_acme")).toBe("EA");
});
