import assert from "node:assert/strict";
import { test } from "node:test";
import { countdown, duration, hourLabel, shiftDays, tildePath, weekOf } from "../src/lib/format.ts";

test("durations read one way everywhere", () => {
  assert.deepEqual([0, 59, 60, 2700, 3600, 4500, 7200].map(duration), ["0 min", "0 min", "1 min", "45 min", "1 h", "1 h 15 min", "2 h"]);
  assert.equal(duration(-5), "0 min");
});

test("a countdown is m:ss and never negative", () => {
  assert.deepEqual([727, 60, 9, 0, -3, 3600].map(countdown), ["12:07", "1:00", "0:09", "0:00", "0:00", "60:00"]);
});

test("hours read as a 12-hour clock", () => {
  assert.deepEqual([0, 5, 12, 18, 23].map(hourLabel), ["12 AM", "5 AM", "12 PM", "6 PM", "11 PM"]);
});

test("dates shift across months and years, and weeks run Monday to Sunday", () => {
  assert.equal(shiftDays("2026-09-01", -1), "2026-08-31");
  assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(weekOf("2026-09-03"), { from: "2026-08-31", to: "2026-09-06" });
  assert.deepEqual(weekOf("2026-09-06"), { from: "2026-08-31", to: "2026-09-06" }, "a Sunday closes its week");
  assert.deepEqual(weekOf("2026-09-07"), { from: "2026-09-07", to: "2026-09-13" });
});

test("only the home folder becomes a tilde", () => {
  assert.equal(tildePath("/Users/someone/Six/exports"), "~/Six/exports");
  assert.equal(tildePath("/Volumes/Users/someone/x"), "/Volumes/Users/someone/x");
});
