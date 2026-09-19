#!/usr/bin/env node
// A planning coach for Six, as an experiment OUTSIDE the app. Six itself stays offline.
//
// One TypeSafe request per list (speculative fan-out): for every row, is it two tasks in
// one, does it have a clear finish, how big is it, what kind of work is it; and for every
// pair of rows, are they the same work. Code then decides what, if anything, to say: at
// most one quiet hint per row, plus facts. The model never writes text.
//
//   TYPESAFE_API_KEY=... node tools/typesafe-eval/coach.mjs            synthetic lists
//   ... coach.mjs --plan my-list.json                                  your own file
//   ... coach.mjs --json                                               raw answers too
//
// Contract read from https://docs.typesafe.ai/api.md on 2026-09-19.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Starting points to evaluate on your own lists, not settled values.
export const THRESHOLDS = { same: 0.8, compound: 0.8, noFinish: 0.25, big: 2.5, bigConfidence: 0.5 };
// Size level (0-3) to a check-in interval in minutes. Six's default is 75.
export const CHECK_IN = [25, 45, 75, 90];
const AREAS = {
  deep_work: "Making or thinking that needs a long uninterrupted stretch: writing, design, analysis, building",
  communication: "Reaching a person: replies, calls, messages, meetings, sending something to someone",
  admin: "Bookings, payments, filings, renewals, tidying records",
  planning: "Deciding what to do or how: prioritising, scoping, reviewing options",
  personal: "Health, family, home, errands outside work",
  other: "None of the above fits",
};

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

export function buildRequest(tasks, model) {
  const state = {
    method:
      "The Ivy Lee method: each evening, write down at most six tasks for tomorrow, most important first. Each task should be one piece of work that can be finished before starting the next.",
    plan: { tasks: tasks.map((t, i) => ({ position: i + 1, title: t.title, note: t.note ?? null })) },
  };
  const questions = {};
  tasks.forEach((_, i) => {
    const at = `\`plan.tasks[${i}].title\``;
    questions[`compound_${i}`] = {
      type: "noul",
      instructions: `Does the task at ${at} describe more than one distinct piece of work, each of which could be finished separately?`,
      criteria: {
        true: "Two or more separable outcomes are joined, for example doing one thing and also deciding another.",
        false: "One outcome, even when a single action covers several objects, such as sending a list and its attachments.",
      },
    };
    questions[`finish_${i}`] = {
      type: "noul",
      instructions: `Could an outside observer tell when the task at ${at} is finished?`,
      criteria: {
        true: "It names a concrete outcome, deliverable or event: something sent, booked, drafted, decided, attended.",
        false: "It is an open-ended activity with no stated end, such as working on, thinking about or looking into something.",
      },
    };
    questions[`size_${i}`] = {
      type: "score",
      instructions: `How much focused work does the task at ${at} most plausibly need? Use its note at \`plan.tasks[${i}].note\` when present.`,
      criteria: [
        "A few minutes: a quick message, call or booking",
        "Under an hour of focused work",
        "One to three hours of focused work",
        "Most of a working day or more, or open-ended",
      ],
    };
    questions[`area_${i}`] = { type: "choice", instructions: `What kind of work is the task at ${at}?`, criteria: AREAS };
    for (let j = i + 1; j < tasks.length; j++) {
      questions[`same_${i}_${j}`] = {
        type: "noul",
        instructions: `Do the tasks at ${at} and \`plan.tasks[${j}].title\` describe the same piece of work, so that finishing one finishes the other?`,
        criteria: {
          true: "The same work in different words.",
          false: "Different work, even if it involves the same person, project or topic.",
        },
      };
    }
  });
  return { state, model, questions };
}

/** Code owns the policy: at most one hint per row, in a fixed order of usefulness. */
export function compose(tasks, answers) {
  const rows = tasks.map((t, i) => {
    const size = answers[`size_${i}`];
    const area = answers[`area_${i}`];
    const compound = answers[`compound_${i}`].noul;
    const finish = answers[`finish_${i}`].noul;
    let twin = null;
    for (let j = 0; j < tasks.length; j++) {
      if (j === i) continue;
      const a = answers[`same_${Math.min(i, j)}_${Math.max(i, j)}`];
      if (a && a.noul >= THRESHOLDS.same && j < i) twin = j;
    }
    let hint = "";
    if (twin !== null) hint = `Same work as row ${twin + 1}.`;
    else if (compound >= THRESHOLDS.compound) hint = "Reads as two tasks.";
    else if (finish <= THRESHOLDS.noFinish) hint = "No clear finish.";
    else if (size.score >= THRESHOLDS.big && size.confidence >= THRESHOLDS.bigConfidence) hint = "Looks like most of a day.";
    const level = Math.max(0, Math.min(CHECK_IN.length - 1, Math.round(size.score)));
    return { position: i + 1, title: t.title, hint, compound, finish, size: size.score, checkIn: CHECK_IN[level], area: area.choice, areaConfidence: area.confidence };
  });
  const mix = {};
  rows.forEach((r) => (mix[r.area] = (mix[r.area] ?? 0) + 1));
  return { rows, mix };
}

export async function ask(body, { key, base }) {
  let wait = 500;
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - started);
    if ((res.status === 429 || res.status === 529) && attempt < 4) {
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`TypeSafe answered ${res.status}: ${text.slice(0, 300)}`);
    return { ...JSON.parse(text), ms };
  }
}

function print(name, { rows, mix }, result) {
  console.log(`\n${name}`);
  console.log("-".repeat(name.length));
  for (const r of rows) {
    const facts = `two-in-one ${r.compound.toFixed(2)} · clear finish ${r.finish.toFixed(2)} · size ${r.size.toFixed(1)} · ${r.area}`;
    console.log(`${r.position}  ${r.title}`);
    console.log(`   ${r.hint ? `hint: ${r.hint}` : "no hint"}   check-in after ${r.checkIn} min`);
    console.log(`   ${facts}`);
  }
  const parts = Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.replace("_", " ")}`);
  console.log(`Mix: ${parts.join(", ")}.`);
  console.log(`${Object.keys(result.answers).length} answers in ${result.ms} ms · ${result.usage.input_tokens} tokens in, ${result.usage.output_tokens} out · ${result.model}`);
}

async function main() {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    console.error("Set TYPESAFE_API_KEY first. This tool never runs without one, and Six itself never calls TypeSafe.");
    process.exit(2);
  }
  const base = (process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/$/, "");
  const model = process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";
  const file = value("--plan") ?? join(here, "samples.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  const plans = data.plans ?? [{ name: file, tasks: data.tasks ?? data }];
  for (const plan of plans) {
    const tasks = plan.tasks.filter((t) => t.title && t.title.trim()).slice(0, 6);
    const result = await ask(buildRequest(tasks, model), { key, base });
    print(plan.name ?? "List", compose(tasks, result.answers), result);
    if (flag("--json")) console.log(JSON.stringify(result.answers, null, 2));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
