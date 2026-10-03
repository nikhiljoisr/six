import test from "node:test";
import assert from "node:assert/strict";
import { soundPlan } from "../src/lib/soundPlan.ts";

test("the default sound is the one Six has always made", () => {
  const original = [
    { freq: 659.25, wave: "sine", at: 0, attack: 0.02, decay: 0.45, peak: 0.06 },
    { freq: 880.0, wave: "sine", at: 0.18, attack: 0.02, decay: 0.45, peak: 0.06 },
  ];
  assert.deepEqual(soundPlan("two_note", "normal"), original);
  assert.deepEqual(soundPlan(undefined, undefined), original);
  assert.deepEqual(soundPlan("airhorn", "eleven"), original, "unknown names fall back");
});

test("the level scales every voice and never clips", () => {
  const soft = soundPlan("bell", "soft");
  const loud = soundPlan("bell", "loud");
  assert.equal(soft.length, 3);
  for (let i = 0; i < soft.length; i++) assert.ok(loud[i].peak > soft[i].peak);
  for (const style of ["two_note", "bell", "knock"]) {
    for (const level of ["soft", "normal", "loud"]) {
      for (const v of soundPlan(style, level)) {
        assert.ok(v.peak > 0 && v.peak <= 0.3, `${style}/${level} peak ${v.peak}`);
        assert.ok(v.at + v.decay < 2, "a sound is over within two seconds");
      }
    }
  }
});
