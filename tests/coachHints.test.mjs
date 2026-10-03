import test from "node:test";
import assert from "node:assert/strict";
import { checkSummary, hintsForRows } from "../src/lib/coachHints.ts";

const checked = {
  titles: ["Send the numbers", "Clean up and decide", "Work on the website", "Call the accountant", "Ring the accountant"],
  hints: [null, { kind: "two_tasks" }, { kind: "no_finish" }, null, { kind: "same_as", row: 4 }],
};
const rows = [...checked.titles, ""];

test("each row says what was found about its title", () => {
  assert.deepEqual(hintsForRows(rows, checked), [null, "Reads as two tasks.", "No clear finish.", null, "Same work as row 4.", null]);
  assert.deepEqual(hintsForRows(rows, null), [null, null, null, null, null, null]);
});

test("a hint follows its row when the list is reordered, and names its twin where it is now", () => {
  const moved = ["Ring the accountant", "", "Call the accountant", "Send the numbers", "Work on the website", "Clean up and decide"];
  assert.deepEqual(hintsForRows(moved, checked), ["Same work as row 3.", null, null, null, "No clear finish.", "Reads as two tasks."]);
});

test("editing a title drops its hint, and a twin that is gone takes the remark with it", () => {
  const edited = ["Send the numbers", "Clean up the vendor list", "Work on the website ", "Phone the accountant", "Ring the accountant", ""];
  assert.deepEqual(hintsForRows(edited, checked), [null, null, "No clear finish.", null, null, null], "trailing spaces are not an edit");
});

test("identical titles keep their own hints", () => {
  const twins = { titles: ["Gym", "Gym"], hints: [null, { kind: "same_as", row: 1 }] };
  assert.deepEqual(hintsForRows(["Gym", "Gym"], twins), [null, "Same work as row 1."]);
  assert.deepEqual(hintsForRows(["Gym", "", "Gym"], twins), [null, null, "Same work as row 1."]);
  assert.deepEqual(hintsForRows(["Gym"], twins), [null]);
});

test("a hint that points nowhere says nothing", () => {
  assert.deepEqual(hintsForRows(["A"], { titles: ["A"], hints: [{ kind: "same_as", row: 7 }] }), [null]);
  assert.deepEqual(hintsForRows(["A"], { titles: ["A"], hints: [{ kind: "same_as", row: 1 }] }), [null], "never its own twin");
  assert.deepEqual(hintsForRows(["A", "B"], { titles: ["A"], hints: [] }), [null, null]);
});

test("the foot line counts the rows that got a note", () => {
  assert.equal(checkSummary([null, null]), "Checked. Nothing to say.");
  assert.equal(checkSummary([{ kind: "two_tasks" }, null]), "Checked. 1 row has a note.");
  assert.equal(checkSummary([{ kind: "two_tasks" }, { kind: "no_finish" }]), "Checked. 2 rows have a note.");
});
