import assert from "node:assert/strict";
import { test } from "node:test";
import { breakMinutes, clockFacts, initialLive } from "../src/lib/clocks.ts";

const task = { id: "t2", position: 2, title: "Draft", note: null, status: "active", carried_from: null, completed_at: null, focus_seconds: 2700, session_started_at: "2026-09-03T05:00:00Z", pomodoros_completed: 2 };
const pomodoro = { enabled: true, minutes: 25, break_minutes: 5, long_break_minutes: 15, set_size: 4, phase: "running", task_id: "t2", started_at: "2026-09-03T05:00:00Z", ends_at: "2026-09-03T05:25:00Z", remaining_seconds: 727, completed_today: 2, completed_for_task: 2, long_break_next: false };
const live = { seconds: 2700, pomodoro: "running", remaining: 727, onBreak: false, breakRemaining: 0 };

test("a running pomodoro names both clocks and what remains", () => {
  const f = clockFacts(task, pomodoro, null, live, false);
  assert.equal(f.taskFact, "45 min");
  assert.equal(f.label, "Pomodoro");
  assert.equal(f.fact, "12:07 left");
  assert.equal(f.quiet, false);
  assert.ok(Math.abs(f.fraction - 727 / 1500) < 1e-9);
  assert.equal(f.dots, 2);
  assert.equal(f.spoken, "Pomodoro running.");
});

test("a rung pomodoro says finished and leaves the track empty", () => {
  const f = clockFacts(task, { ...pomodoro, phase: "done" }, null, { ...live, pomodoro: "done", remaining: 0 }, false);
  assert.equal(f.fact, "finished");
  assert.equal(f.fraction, 0);
  assert.match(f.spoken, /still recording/);
});

test("no timer is said quietly, with no track", () => {
  const f = clockFacts(task, { ...pomodoro, phase: "idle" }, null, { ...live, pomodoro: "idle", remaining: 0 }, false);
  assert.deepEqual([f.label, f.fact, f.quiet, f.fraction], ["Pomodoro", "not running", true, null]);
});

test("with pomodoros switched off there is no second clock", () => {
  const f = clockFacts(task, { ...pomodoro, enabled: false }, null, { ...live, pomodoro: "idle" }, false);
  assert.deepEqual([f.label, f.fact, f.fraction], ["", "", null]);
  assert.equal(f.dots, 2, "completed pomodoros still count");
});

test("a break counts down, then is over; task time reads paused throughout", () => {
  const brk = { started_at: "2026-09-03T05:00:00Z", ends_at: "2026-09-03T05:05:00Z", minutes: 5, long: false };
  const on = clockFacts(task, pomodoro, brk, { ...live, onBreak: true, breakRemaining: 192 }, true);
  assert.deepEqual([on.taskFact, on.label, on.fact], ["45 min · paused", "Break", "3:12 left"]);
  assert.ok(Math.abs(on.fraction - 192 / 300) < 1e-9);
  const over = clockFacts(task, pomodoro, brk, { ...live, onBreak: true, breakRemaining: 0 }, true);
  assert.deepEqual([over.fact, over.fraction], ["over", 0]);
  const plain = clockFacts(task, pomodoro, null, live, true);
  assert.deepEqual([plain.taskFact, plain.label, plain.fraction], ["45 min · paused", "", null]);
});

test("the track never leaves 0..1, whatever the poll reports", () => {
  const brk = { started_at: "2026-09-03T05:00:00Z", ends_at: "2026-09-03T05:05:00Z", minutes: 5, long: false };
  assert.equal(clockFacts(task, pomodoro, brk, { ...live, breakRemaining: 9999 }, true).fraction, 1);
  assert.equal(clockFacts(task, pomodoro, null, { ...live, remaining: 99999 }, false).fraction, 1);
});

test("the break offered is the long one once a set is complete", () => {
  assert.equal(breakMinutes(pomodoro), 5);
  assert.equal(breakMinutes({ ...pomodoro, long_break_next: true }), 15);
});

test("the clock starts from the snapshot, and only this task's pomodoro counts", () => {
  const start = initialLive(task, pomodoro, null, "2026-09-03T05:12:53Z");
  assert.deepEqual(start, { seconds: 2700, pomodoro: "running", remaining: 727, onBreak: false, breakRemaining: 0 });
  const other = initialLive({ ...task, id: "t3" }, pomodoro, null, "2026-09-03T05:12:53Z");
  assert.deepEqual([other.pomodoro, other.remaining], ["idle", 0]);
  const brk = { started_at: "2026-09-03T05:00:00Z", ends_at: "2026-09-03T05:05:00Z", minutes: 5, long: false };
  assert.equal(initialLive(task, pomodoro, brk, "2026-09-03T05:01:48Z").breakRemaining, 192);
  assert.equal(initialLive(task, pomodoro, brk, "2026-09-03T05:30:00Z").breakRemaining, 0);
});
