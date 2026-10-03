#!/usr/bin/env node
// Scores the coach against lists that carry the hint a careful reader would expect.
// The question it answers: would the hints help more than they nag?
//
//   TYPESAFE_API_KEY=... node tools/typesafe-eval/evaluate.mjs [--set file.json] [--runs 2]
//
// It sends exactly what Six sends (titles only; see buildAppRequest in coach.mjs).
// "none" rows are the ones that matter most: a hint there is a false alarm. "any" rows
// are fair either way and are not scored. Everything sent is synthetic.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ask, buildAppRequest, compose } from "./coach.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const KIND = { "Reads as two tasks.": "two", "No clear finish.": "finish", "Looks like most of a day.": "big" };
const kindOf = (hint) => (hint.startsWith("Same work as") ? "same" : (KIND[hint] ?? "none"));

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.error("Set TYPESAFE_API_KEY first.");
  process.exit(2);
}
const base = (process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, "");
const model = process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";
const set = JSON.parse(readFileSync(value("--set") ?? join(here, "eval-set.json"), "utf8"));
const runs = Number(value("--runs") ?? 1);

const tally = { right: 0, falseAlarm: 0, missed: 0, wrongKind: 0, unscored: 0, ms: [], tokens: 0, flips: 0 };
const lines = [];
for (const plan of set.plans) {
  const first = [];
  for (let run = 0; run < runs; run++) {
    const result = await ask(buildAppRequest(plan.tasks, model), { key, base });
    tally.ms.push(result.ms);
    tally.tokens += result.usage.input_tokens;
    const { rows } = compose(plan.tasks, result.answers);
    rows.forEach((r, i) => {
      const got = kindOf(r.hint);
      if (run > 0) {
        if (got !== first[i]) {
          tally.flips++;
          const want = plan.tasks[i].expect;
          if (want === "none" && got !== "none") tally.falseAlarm++;
          lines.push(`${"changed".padEnd(12)} want ${want.padEnd(6)} got ${got.padEnd(6)} (was ${first[i]}) two ${r.compound.toFixed(2)} finish ${r.finish.toFixed(2)} size ${r.size.toFixed(1)}  ${r.title}`);
        }
        return;
      }
      first[i] = got;
      const want = plan.tasks[i].expect;
      let verdict = "ok";
      if (want === "any") {
        tally.unscored++;
        verdict = "unscored";
      } else if (got === want) tally.right++;
      else if (want === "none") {
        tally.falseAlarm++;
        verdict = "FALSE ALARM";
      } else if (got === "none") {
        tally.missed++;
        verdict = "missed";
      } else {
        tally.wrongKind++;
        verdict = "other hint";
      }
      lines.push(`${verdict.padEnd(12)} want ${want.padEnd(6)} got ${got.padEnd(6)} two ${r.compound.toFixed(2)} finish ${r.finish.toFixed(2)} size ${r.size.toFixed(1)}  ${r.title}`);
    });
  }
}
console.log(lines.join("\n"));
const scored = tally.right + tally.falseAlarm + tally.missed + tally.wrongKind;
tally.ms.sort((a, b) => a - b);
console.log(`\n${scored} rows scored, ${tally.unscored} not scored.`);
console.log(`right ${tally.right} · false alarms ${tally.falseAlarm} · missed ${tally.missed} · a different hint ${tally.wrongKind}`);
if (runs > 1) console.log(`hints that changed between runs: ${tally.flips}`);
console.log(`median ${tally.ms[Math.floor(tally.ms.length / 2)]} ms per list · ${Math.round(tally.tokens / tally.ms.length)} tokens per list · ${model}`);
