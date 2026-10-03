import assert from "node:assert/strict";
import { test } from "node:test";
import { backFrom } from "../src/lib/nav.ts";

test("back leads up one level, and Settings returns to where it was opened from", () => {
  assert.deepEqual(backFrom({ name: "history" }, null), { name: "day" });
  assert.deepEqual(backFrom({ name: "stats" }, { name: "history" }), { name: "history" });
  assert.deepEqual(backFrom({ name: "settings" }, { name: "day" }), { name: "day" });
  assert.deepEqual(backFrom({ name: "settings" }, { name: "stats" }), { name: "stats" });
  assert.deepEqual(backFrom({ name: "settings" }, null), { name: "history" });
  assert.deepEqual(backFrom({ name: "settings" }, { name: "settings" }), { name: "history" });
});

test("there is no back from home, nor from a screen holding unsaved input", () => {
  assert.equal(backFrom({ name: "day" }, { name: "history" }), null);
  assert.equal(backFrom({ name: "planner", date: "2026-09-03" }, { name: "day" }), null);
  assert.equal(backFrom({ name: "review", planId: "p" }, { name: "day" }), null);
});
