// node tools/typesafe-eval/selftest.mjs — exercises coach.mjs against the local stand-in.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ask, buildRequest, compose, THRESHOLDS } from "./coach.mjs";
import { start } from "./mock-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const coach = join(here, "coach.mjs");
const plans = JSON.parse(readFileSync(join(here, "samples.json"), "utf8")).plans;

// 1. Without a key the tool refuses, and says why.
const noKey = spawnSync(process.execPath, [coach], { env: { PATH: process.env.PATH }, encoding: "utf8" });
assert.equal(noKey.status, 2);
assert.match(noKey.stderr, /TYPESAFE_API_KEY/);

// 2. The request is one fan-out per list, shaped as the API documents it.
const body = buildRequest(plans[0].tasks, "jev-latest");
assert.equal(Object.keys(body.questions).length, 6 * 4 + 15, "four per row plus every pair");
assert.equal(body.state.plan.tasks.length, 6);
assert.ok(Object.values(body.questions).every((q) => q.instructions.includes("`plan.tasks[")), "every question points at its row by path");

const { server, seen, url } = await start({ busyFirst: 2 });
try {
  // 3. A 529 is retried with backoff rather than failing the run.
  const result = await ask(body, { key: "test", base: url });
  assert.equal(seen.length, 1, "two overloaded answers, then one accepted request");
  const { rows, mix } = compose(plans[0].tasks, result.answers);

  // 4. Code owns the policy: one hint per row at most, duplicates named on the later row.
  assert.equal(rows[2].hint, "Reads as two tasks.");
  assert.equal(rows[3].hint, "No clear finish.");
  assert.equal(rows[5].hint, "Same work as row 5.");
  assert.equal(rows[4].hint, "", "the first of two twins is left alone");
  assert.equal(rows[0].hint, "");
  assert.equal(rows[0].checkIn, 25);
  assert.equal(Object.values(mix).reduce((a, b) => a + b, 0), 6);
  assert.ok(THRESHOLDS.same > 0.5 && THRESHOLDS.compound > 0.5);

  // 5. A bad key and a malformed question surface the service's own status.
  await assert.rejects(ask(body, { key: "", base: url }), /401/);
  await assert.rejects(ask({ ...body, questions: { x: { type: "score", instructions: "?", criteria: ["only one"] } } }, { key: "test", base: url }), /422/);

  // 6. End to end through the command line. Asynchronous on purpose: the stand-in server
  //    lives in this process, so a synchronous child would wait on a blocked parent.
  const { stdout: out } = await promisify(execFile)(process.execPath, [coach], {
    env: { PATH: process.env.PATH, TYPESAFE_API_KEY: "test", TYPESAFE_BASE_URL: url },
    encoding: "utf8",
    timeout: 20000,
  });
  assert.match(out, /A mixed list/);
  assert.match(out, /hint: Reads as two tasks\./);
  assert.match(out, /hint: Looks like most of a day\./);
  assert.match(out, /Mix: /);
  console.log(out.trim());
  console.log("\nselftest: all checks passed (answers above come from the local stand-in, not from TypeSafe)");
} finally {
  server.close();
}
