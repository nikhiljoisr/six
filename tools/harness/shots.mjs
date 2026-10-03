// Renders every seeded scene to PNG, at the sizes the real windows have.
//   pnpm build && node tools/harness/shots.mjs [--only running,ring] [--out dir] [--set key:value,…] [--dark] [--batch 2]
// The main window's content area is 480×532 points (560 minus the title bar); the menu
// bar panel is 320 wide and as tall as its content.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { start } from "./serve.mjs";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

export const MAIN = { width: 480, height: 532 };
export const PANEL = { width: 320, height: 300 };
/** name → query. `wait` covers scenes that click their way somewhere after loading. */
export const SHOTS = [
  { name: "day-morning", query: "state=morning" },
  { name: "day-evening-ritual", query: "state=morning&phase=evening" },
  { name: "day-idle", query: "state=idle" },
  { name: "day-running", query: "state=running" },
  { name: "day-ring", query: "state=ring" },
  { name: "day-break", query: "state=break" },
  { name: "day-break-over", query: "state=break-over" },
  { name: "day-paused", query: "state=paused" },
  { name: "day-no-pomodoro", query: "state=no-pomodoro" },
  { name: "day-long", query: "state=long" },
  { name: "day-six-done", query: "state=six-done" },
  { name: "day-evening", query: "state=idle&phase=evening" },
  { name: "day-tomorrow-planned", query: "state=tomorrow-planned&phase=evening" },
  { name: "day-edited", query: "state=edited" },
  { name: "day-banner", query: "state=banner" },
  { name: "day-return-gap", query: "state=return-gap" },
  { name: "day-jot", query: "state=jot", wait: 2600 },
  { name: "day-morning-unreviewed", query: "state=morning-unreviewed" },
  { name: "day-evening-unreviewed", query: "state=morning-unreviewed&phase=evening" },
  { name: "day-evening-planned-unreviewed", query: "state=evening-planned-unreviewed&phase=evening" },
  { name: "skip-1", query: "state=skip-1" },
  { name: "skip-2", query: "state=skip-2" },
  { name: "skip-3", query: "state=skip-3", wait: 3200 },
  { name: "planner-today", query: "state=planner-today" },
  { name: "planner-tomorrow", query: "state=planner-tomorrow" },
  { name: "planner-empty", query: "state=planner-empty" },
  { name: "planner-error", query: "state=planner-error", wait: 3200 },
  { name: "planner-pending", query: "state=planner-pending", wait: 2800 },
  { name: "planner-coach", query: "state=planner-coach", wait: 5000 },
  { name: "review-1", query: "state=review-1&phase=evening" },
  { name: "review-2", query: "state=review-2&phase=evening", wait: 3000 },
  { name: "review-jots", query: "state=review-jots&phase=evening" },
  { name: "review-past", query: "state=review-past" },
  { name: "review-past-2", query: "state=review-past-2", wait: 3000 },
  { name: "review-later", query: "state=review-later" },
  { name: "history", query: "state=history" },
  { name: "history-open", query: "state=history-open", wait: 3000 },
  { name: "stats", query: "state=stats" },
  { name: "settings", query: "state=settings" },
  { name: "welcome-1", query: "state=welcome-1" },
  { name: "welcome-2", query: "state=welcome-2" },
  { name: "panel-running", query: "win=popover&state=running", panel: true },
  { name: "panel-ring", query: "win=popover&state=ring", panel: true },
  { name: "panel-paused", query: "win=popover&state=paused", panel: true },
  { name: "panel-morning", query: "win=popover&state=morning", panel: true },
  { name: "panel-break-over-banner", query: "win=popover&state=panel-break-over-banner", panel: true },
];

async function renderer() {
  const source = join(here, "render.swift");
  const binary = join(here, ".bin", "render");
  if (!existsSync(binary) || statSync(binary).mtimeMs < statSync(source).mtimeMs) {
    mkdirSync(dirname(binary), { recursive: true });
    await run("swiftc", ["-O", source, "-o", binary]);
  }
  return binary;
}

async function main() {
  if (!existsSync(join(here, "../../dist/index.html"))) {
    console.error("No dist/ yet: run `pnpm build` first.");
    process.exit(2);
  }
  const only = value("--only")?.split(",");
  const out = resolve(value("--out") ?? join(here, "out"));
  const set = value("--set");
  const dark = args.includes("--dark");
  mkdirSync(out, { recursive: true });
  const render = await renderer();
  const { server, url } = await start();
  try {
    const shots = SHOTS.filter((s) => !only || only.includes(s.name));
    // A few at a time: each is its own short-lived process. The time limit is generous
    // because a busy machine can take most of a minute over one render.
    const batch = Number(value("--batch") ?? 4);
    for (let i = 0; i < shots.length; i += batch) {
      await Promise.all(
        shots.slice(i, i + batch).map(async (shot) => {
          const size = shot.panel ? PANEL : MAIN;
          const query = set ? `${shot.query}&set=${set}` : shot.query;
          const file = join(out, `${shot.name}.png`);
          const cli = [`${url}/?${query}`, file, String(size.width), String(size.height), String(shot.wait ?? 2400)];
          if (dark) cli.push("--dark");
          // WebKit's snapshot can fail outright when the machine is starved; wait and try again.
          for (let attempt = 1; ; attempt++) {
            try {
              await run(render, cli, { timeout: 180000 });
              break;
            } catch (e) {
              if (attempt === 8) throw e;
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
          }
          console.log(`${shot.name}.png`);
        }),
      );
    }
    console.log(`${shots.length} renders in ${out}`);
  } finally {
    server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
