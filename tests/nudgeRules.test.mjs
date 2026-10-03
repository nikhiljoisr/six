import assert from "node:assert/strict";
import { test } from "node:test";
import { kindOf, sameInstant, stillApplies } from "../src/lib/nudgeRules.ts";

const task = (over = {}) => ({ id: "t2", position: 2, title: "Draft", note: null, status: "active", carried_from: null, completed_at: null, focus_seconds: 0, session_started_at: null, pomodoros_completed: 0, ...over });
const snap = ({ tasks = [task()], pomodoro = {}, plan = {}, tomorrow = null } = {}) => ({
  revision: 1,
  today: "2026-09-03",
  tomorrow: "2026-09-04",
  now: "2026-09-03T05:00:00Z",
  phase: "before_evening",
  settings: {},
  streak: 0,
  today_plan: tasks ? { id: "p", date: "2026-09-03", locked_at: "2026-09-02T13:00:00Z", reviewed_at: null, tasks, ...plan } : null,
  tomorrow_plan: tomorrow,
  carryover_preview: null,
  pomodoro: { phase: "idle", task_id: "t2", ends_at: null, ...pomodoro },
  break: null,
});
const nudge = (kind, over = {}) => ({ kind, due: "2026-09-03T05:25:00Z", title: "", body: "", actions: [], task_id: "t2", ...over });

test("a ring is fresh while its own pomodoro is still counting down or has just rung", () => {
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ pomodoro: { phase: "done" } })), true);
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ pomodoro: { phase: "running", ends_at: "2026-09-03T05:25:00.000Z" } })), true, "delivered just before it settles");
});

test("a ring is stale once answered: another pomodoro, no pomodoro, or another task", () => {
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ pomodoro: { phase: "running", ends_at: "2026-09-03T05:50:00Z" } })), false, "one more was chosen");
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ pomodoro: { phase: "idle" } })), false);
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ pomodoro: { phase: "done", task_id: "t3" } })), false);
  assert.equal(stillApplies(nudge("pomodoro_done"), snap({ tasks: [task({ status: "paused" })], pomodoro: { phase: "done" } })), false);
});

test("a nudge about a task dies with that task's moment", () => {
  assert.equal(stillApplies(nudge("check_in"), snap()), true);
  assert.equal(stillApplies(nudge("check_in"), snap({ pomodoro: { phase: "running" } })), false, "a pomodoro took over");
  assert.equal(stillApplies(nudge("check_in"), snap({ tasks: [task({ status: "done" })] })), false);
  assert.equal(stillApplies(nudge("check_in", { task_id: "gone" }), snap()), false);
  assert.equal(stillApplies(nudge("break_over"), snap({ tasks: [task({ status: "paused" })] })), true);
  assert.equal(stillApplies(nudge("break_over"), snap()), false, "already resumed");
});

test("day-level nudges follow the day", () => {
  const day = (kind) => nudge(kind, { task_id: null });
  assert.equal(stillApplies(day("unplanned_morning"), snap({ tasks: null })), true);
  assert.equal(stillApplies(day("unplanned_morning"), snap()), false);
  assert.equal(stillApplies(day("end_of_day"), snap()), true);
  assert.equal(stillApplies(day("end_of_day"), snap({ plan: { reviewed_at: "2026-09-03T13:00:00Z" } })), false);
  assert.equal(stillApplies(day("evening_ritual"), snap()), true);
  assert.equal(stillApplies(day("evening_ritual"), snap({ tomorrow: { locked_at: "2026-09-03T13:00:00Z" } })), false);
  assert.equal(stillApplies(day("unplanned_morning"), snap({ plan: { locked_at: null } })), true, "a draft is not a list");
});

test("instants compare by time, not by spelling", () => {
  assert.equal(sameInstant("2026-09-03T05:25:00Z", "2026-09-03T05:25:00.000+00:00"), true);
  assert.equal(sameInstant("2026-09-03T05:25:01Z", "2026-09-03T05:25:00Z"), false);
  assert.equal(sameInstant(null, "2026-09-03T05:25:00Z"), false);
});

test("an OS notification names its nudge by id, else by action type", () => {
  assert.equal(kindOf({ notification: { id: 602 } }), "check_in");
  assert.equal(kindOf({ id: 606 }), "pomodoro_done");
  assert.equal(kindOf({ notification: { actionTypeId: "pomodoro_done_long" } }), "pomodoro_done");
  assert.equal(kindOf({ actionTypeId: "end_of_day" }), "end_of_day");
  assert.equal(kindOf({ notification: { id: 999, actionTypeId: "something_else" } }), null);
  assert.equal(kindOf({}), null);
});
