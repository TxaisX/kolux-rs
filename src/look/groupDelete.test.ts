import { expect, test } from "vitest";
import { HEADER_COLOURS_SETTING, colourSaveAfterDelete, headersGoneWithGroup } from "./headerColour";

const members = { a: "g1", b: "g1", c: "g2", d: "" };
const colours = { [HEADER_COLOURS_SETTING]: { "p:a": "blue", "p:b": "green", "p:c": "red", "g:g1": "pink", "g:g2": "amber" } };

test("FIX-2: the headers that go with a deleted group are read from the members as they were before the delete", () => {
  expect(headersGoneWithGroup(members, "g1", true)).toEqual([{ kind: "g", id: "g1" }, { kind: "p", id: "a" }, { kind: "p", id: "b" }]);
  const before = { ...members };
  const gone = headersGoneWithGroup(members, "g1", true);
  expect(members, "the members map is only read").toEqual(before);
  // the group_delete answer has no members left: asking after the delete finds nothing, which is why the panel asks first
  expect(headersGoneWithGroup({ c: "g2", d: "" }, "g1", true)).toEqual([{ kind: "g", id: "g1" }]);
  expect(gone).toHaveLength(3);
});

test("FIX-2: deleting a group but keeping its projects (remove=false) keeps the project colours", () => {
  const gone = headersGoneWithGroup(members, "g1", false);
  expect(gone).toEqual([{ kind: "g", id: "g1" }]);
  expect(colourSaveAfterDelete(colours, gone)).toEqual({ "p:a": "blue", "p:b": "green", "p:c": "red", "g:g2": "amber" });
});

test("FIX-2: removing the projects too drops their colours and the group's, and nobody else's", () => {
  const next = colourSaveAfterDelete(colours, headersGoneWithGroup(members, "g1", true));
  expect(next).toEqual({ "p:c": "red", "g:g2": "amber" });
});

test("FIX-2: nothing to prune means no save at all", () => {
  expect(colourSaveAfterDelete({}, headersGoneWithGroup(members, "g1", true))).toBeNull();
  expect(colourSaveAfterDelete(colours, headersGoneWithGroup(members, "nope", true))).toBeNull();
  expect(colourSaveAfterDelete({ [HEADER_COLOURS_SETTING]: { "p:c": "red" } }, headersGoneWithGroup(members, "g1", false))).toBeNull();
  expect(colourSaveAfterDelete({ [HEADER_COLOURS_SETTING]: "junk" }, [{ kind: "g", id: "g1" }])).toBeNull();
});

test("FIX-2: the prune is worked out from the settings given at that moment, not from an earlier snapshot", () => {
  const gone = headersGoneWithGroup(members, "g1", true);
  const stale = { [HEADER_COLOURS_SETTING]: { "p:a": "blue" }, other: 1 };
  const fresh = { [HEADER_COLOURS_SETTING]: { "p:a": "blue", "p:c": "red" }, other: 2 };
  expect(colourSaveAfterDelete(stale, gone)).toEqual({});
  expect(colourSaveAfterDelete(fresh, gone), "a colour picked during the await survives").toEqual({ "p:c": "red" });
});
