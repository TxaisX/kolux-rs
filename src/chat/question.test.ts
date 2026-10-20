// CHAT-022 (T-327-b): the question card. Synthetic transcript rows written for this test.
import { beforeEach, describe, expect, it } from "vitest";
import { answerSteps, closeQuestion, forgetQuestions, openQuestion, sendAnswer, sigOf, type Pick, type QuestionDeps } from "./question";
import type { ChatItem } from "./model";
import type { Question } from "./steps";

const q = (question: string, labels: string[], multi = false): Question => ({ question, header: "", multi, options: labels.map((label) => ({ label, description: "" })) });
const ask = (call: string, questions: Question[], done = false): ChatItem => ({
  id: "i-" + call,
  role: "assistant",
  kind: "tool",
  text: "",
  tool: { call, name: "AskUserQuestion", group: "other", preview: questions[0]?.question ?? "", done, failed: false, background: false, questions },
});
const user = (text: string): ChatItem => ({ id: "u-" + text, role: "user", kind: "text", text });
const say = (text: string): ChatItem => ({ id: "a-" + text, role: "assistant", kind: "text", text });
const three = q("Which framework?", ["React", "Vue", "Svelte"]);

beforeEach(forgetQuestions);

describe("when the question card shows", () => {
  it("shows the newest open ask while the agent waits, and keeps the call id", () => {
    expect(openQuestion([user("go"), say("Let me ask."), ask("c1", [three])], true)).toEqual({ id: "c1", sig: "Which framework?", questions: [three] });
    expect(openQuestion([ask("c1", [three])], undefined)?.id).toBe("c1");
  });
  it("is gone once answered, interrupted, followed by a user message, or the agent is not waiting", () => {
    expect(openQuestion([ask("c1", [three], true)], true)).toBeNull();
    expect(openQuestion([ask("c1", [three]), { id: "x", role: "status", kind: "interrupted", text: "Interrupted" }], true)).toBeNull();
    expect(openQuestion([ask("c1", [three]), user("/clear")], true)).toBeNull();
    expect(openQuestion([ask("c1", [three])], false)).toBeNull();
    expect(openQuestion([say("hi")], true)).toBeNull();
    expect(openQuestion([ask("c1", [])], true)).toBeNull();
  });
  it("stays hidden once closed, even when the same question is asked again", () => {
    closeQuestion(sigOf([three]));
    expect(openQuestion([ask("c2", [three])], true)).toBeNull();
    expect(openQuestion([ask("c3", [q("Another?", ["a"])])], true)?.id).toBe("c3");
  });
});

const pick = (chosen: number[], text = "", skipped = false): Pick => ({ chosen, text, skipped });
const keys = (qs: Question[], ps: Pick[]) => answerSteps(qs, ps).map((s) => s.data);

describe("the keys an answer types", () => {
  it("one option is its number, from 1", () => {
    expect(keys([three], [pick([1])])).toEqual(["2"]);
  });
  it("several picks are their numbers then Enter; two questions end with Enter for the review", () => {
    const tools = q("Which checks?", ["lint", "test", "build"], true);
    expect(keys([tools], [pick([2, 0])])).toEqual(["1", "3", "\r"]);
    expect(keys([three, tools], [pick([0]), pick([1])])).toEqual(["1", "2", "\r", "\r"]);
  });
  it("a typed answer picks Other (the number after the last option), types the words and ends with Enter", () => {
    expect(keys([three], [pick([], "Solid, please")])).toEqual(["4", "Solid, please", "\r"]);
    expect(keys([three], [pick([1], "line one\nline two")])).toEqual(["4", "line one line two", "\r"]);
  });
  it("a skipped question moves on with the right arrow; skipping everything types nothing", () => {
    expect(keys([three, three], [pick([], "", true), pick([2])])).toEqual(["\x1b[C", "3", "\r"]);
    expect(keys([three, three], [pick([]), pick([], "", true)])).toEqual([]);
    expect(keys([three], [])).toEqual([]);
  });
  it("an option past number 9 cannot be typed as one key, so nothing is typed", () => {
    const many = q("Pick", Array.from({ length: 10 }, (_, i) => "o" + i));
    expect(keys([many], [pick([9])])).toEqual([]);
    expect(keys([many], [pick([], "x")])).toEqual([]);
  });
  it("control characters in a typed answer are made harmless", () => {
    expect(keys([three], [pick([], "ok\x1b[Bno\x03")])).toEqual(["4", "ok[Bno", "\r"]);
  });
});

describe("typing the answer into the terminal", () => {
  const steps = answerSteps([three, three], [pick([0]), pick([1])]);
  const run = (over: Partial<QuestionDeps> = {}, cancelAfter = Infinity) => {
    const wrote: string[] = [];
    const deps: QuestionDeps = {
      terminalOf: () => 71,
      stateOf: () => "waiting",
      write: async (_t, d) => void wrote.push(d),
      current: () => "c1",
      sleep: async () => {},
      ...over,
    };
    const card = { id: "c1", sig: sigOf([three]), questions: [three] };
    let h: ReturnType<typeof sendAnswer> | undefined;
    const write = deps.write;
    deps.write = async (t, d) => {
      await write(t, d);
      if (wrote.length >= cancelAfter) h?.cancel();
    };
    h = sendAnswer(9, card, steps, deps);
    return { wrote, done: h.done };
  };

  it("types every key in order", async () => {
    const r = run();
    expect(await r.done).toBe("sent");
    expect(r.wrote).toEqual(["1", "2", "\r"]);
  });
  it("Cancel drops the keys not yet typed", async () => {
    const r = run({}, 1);
    expect(await r.done).toBe("stopped");
    expect(r.wrote).toEqual(["1"]);
  });
  it("drops the rest when the terminal changes, the agent stops waiting, or another card takes its place", async () => {
    let n = 0;
    const a = run({ terminalOf: () => (n++ < 2 ? 71 : 72) });
    expect(await a.done).toBe("stopped");
    expect(a.wrote.length).toBeLessThan(3);
    const b = run({ stateOf: () => "working" });
    expect(await b.done).toBe("stopped");
    expect(b.wrote).toEqual([]);
    const c = run({ current: () => "c2" });
    expect(await c.done).toBe("stopped");
    expect(c.wrote).toEqual([]);
  });
  it("says so when the pane has no terminal, and types nothing", async () => {
    const r = run({ terminalOf: () => undefined });
    expect(await r.done).toBe("no-terminal");
    expect(r.wrote).toEqual([]);
  });
  it("a write that fails ends the send as stopped", async () => {
    const r = run({ write: async () => Promise.reject(new Error("gone")) });
    expect(await r.done).toBe("stopped");
  });
});
