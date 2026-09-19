# A planning coach, evaluated outside the app

Six is offline by principle and stays that way: nothing in this folder is bundled into the
app, run by CI, or called by Six. This is a bench for answering one question before any
product decision is made: **are TypeSafe's judgments about a day's six tasks good enough
to be worth a quiet hint?**

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

## Before any of this could ship in Six

An amendment to SPEC §2 ("Offline only") and the README's privacy promise, recorded in
`docs/DECISIONS.md`; a switch that is off by default; the key in the macOS Keychain; the
call made from the Rust core, never the webview; and the app working exactly as it does
today whenever the switch is off, the key is missing or the network is down.
