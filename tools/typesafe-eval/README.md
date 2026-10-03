# The planning coach's bench

Six has an optional planning coach (Settings; off by default): "Check the list" in the
planner sends that list's task titles to TypeSafe and each row may get one remark. This
folder is where that was decided and where it is kept honest. Nothing here is bundled
into the app or run by CI.

- `coach.mjs` asks the questions for a list and prints every answer. Its
  `buildAppRequest` is the request Six itself sends (titles only), and `compose` is the
  policy Six applies; the Rust copies are in `src-tauri/src/domain/coach.rs`. Both are
  pinned to `fixtures/app-request.json`, read by the Rust tests and by `selftest.mjs`.
- `evaluate.mjs` scores the coach against `eval-set.json`: 48 made-up rows, each with
  the remark a careful reader would expect.
- `selftest.mjs` needs no key: it runs the tool against `mock-server.mjs`.

## What the evaluation found (3 October 2026, jev-1.13.0)

48 rows, 42 of them scored (6 are fair either way), four runs:

| | |
|---|---|
| Right | 40 or 41 of 42 |
| False alarms (a remark on a good row) | 0 in every run |
| Missed | 1 or 2, always a duplicate worded differently |
| Changed between runs | at most 1 row, that same duplicate |
| Time | about 0.35 s a list |
| Tokens | about 3,300 a list (a small fraction of a cent) |

The number that decided it is the false alarms: a remark on a good row would be a nag,
and there were none. A miss costs nothing: Six then behaves as it does with the coach
off. Traps for the word "and" ("Research and book flights", 0.76) stayed under the
two-in-one threshold of 0.85; real two-in-ones started at 0.91.

Run it again before changing a threshold or a question, and when TypeSafe's model
changes:

```bash
TYPESAFE_API_KEY=... node tools/typesafe-eval/evaluate.mjs --runs 2
```

## What it asks

One request per list (TypeSafe's speculative fan-out: every question over the same state,
answered independently and in parallel). For six rows that is 39 questions:

| Per row | Type | Why |
|---|---|---|
| Is this more than one piece of work? | Noul | "Send the list and the statements" is one task; "clean up X and decide Y" is two. A search for " and " cannot tell them apart. |
| Could an observer tell when it is finished? | Noul | "Work on the website" never ends; the method needs rows that do. |
| How much focused work is it? | Score, four levels | Drives a per-task check-in interval instead of one global 75 minutes. |
| What kind of work is it? | Choice, six areas | A weekly fact: "11 communication, 4 deep work". |
| **Per pair:** the same work in different words? | Noul | Catches a retyped carry-over taking a second row. |

The model never writes text. Code decides what to say: at most **one** hint per row, in
the order duplicate, two-in-one, no clear finish, most of a day; and only past the
thresholds at the top of `coach.mjs`, which are starting points to evaluate, not findings.

## Run it

```bash
node tools/typesafe-eval/selftest.mjs
```

needs no key: it runs the tool against `mock-server.mjs`, a local stand-in that checks the
request against the documented contract and answers with keyword rules. Its answers say
nothing about the real model.

```bash
TYPESAFE_API_KEY=... node tools/typesafe-eval/coach.mjs
```

sends the two **synthetic** lists in `samples.json` to TypeSafe and prints the hints, the
raw probabilities, the latency and the token usage. `--plan file.json` evaluates a list of
your own (`{"tasks":[{"title":"…","note":"…"}]}`); `--json` prints every answer.

Anything in a file you pass with `--plan` is sent to `api.typesafe.ai`. Your task titles
are yours to send or not; the tool never reads Six's database.

## What to look for

- Does "two-in-one" separate the two " and " examples in the samples, and your own?
- Is "no clear finish" right often enough that a hint would help more than it nags?
- Does the size level match your sense of the task? It only ever moves a check-in.
- Latency per list, and tokens per list, against how often a list is locked (once a day).

## What Six did not take from here

The bench also asks what kind of work each row is and turns its size into a check-in
interval. Six uses neither: four remarks are enough, and a per-task interval or a weekly
"mix" would be more to explain than they are worth. Notes are never sent by Six.
