import test from "node:test";
import assert from "node:assert/strict";
import { reviewFlow } from "../src/lib/reviewFlow.ts";

test("today's review is the evening ritual and ends in tomorrow's planner", () => {
  assert.deepEqual(reviewFlow(true, true, 3), { past: false, steps: 3, askCarry: true, endsIn: "planner" });
  // Tomorrow already locked, or nothing left: still the same three screens.
  assert.deepEqual(reviewFlow(true, false, 0), { past: false, steps: 3, askCarry: true, endsIn: "planner" });
});

test("a past day that is still the latest list asks what carries, and plans nothing", () => {
  assert.deepEqual(reviewFlow(false, true, 2), { past: true, steps: 2, askCarry: true, endsIn: "back" });
});

test("a past day with nothing left, or with a later list, is one screen", () => {
  assert.deepEqual(reviewFlow(false, true, 0), { past: true, steps: 1, askCarry: false, endsIn: "back" });
  assert.deepEqual(reviewFlow(false, false, 4), { past: true, steps: 1, askCarry: false, endsIn: "back" });
});
