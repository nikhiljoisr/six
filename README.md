# Six

A calm daily companion for the Mac that does two things: it holds the six tasks that
matter today, and it keeps you on the one at the top.

Six is built on the **Ivy Lee method** (1918): at the end of each day, write down the six
most important tasks for tomorrow, in order. Next day, work on the first until it is done,
then the second. Whatever is unfinished rolls into tomorrow's list. Nothing else. On top of
that sits an optional **Pomodoro** layer: a 25-minute countdown on the task you are on, a
silent ring, a short break, a long one after four.

Everything stays on your Mac. There is no account, no server, and nothing leaves the
machine.

## Download

1. Get `Six.app.zip` from the [latest release](https://github.com/nikhiljoisr/six/releases/latest)
   and unzip it.
2. Move `Six.app` to your Applications folder.
3. Open it. **The first time, macOS will refuse** (see the next section). After that it
   opens like any other app.

Universal build: Apple Silicon and Intel Macs, macOS 13 or later.

## "Six cannot be opened" the first time

Six is signed locally rather than notarised with an Apple Developer certificate, so
Gatekeeper blocks it once. Either of these fixes it for good:

- Open **System Settings → Privacy & Security**, scroll down to the message about Six, and
  click **Open Anyway**. Confirm, and it opens.
- Or, in Terminal, remove the quarantine flag and open it:

  ```bash
  xattr -cr /Applications/Six.app && open /Applications/Six.app
  ```

On older versions of macOS, right-clicking the app and choosing **Open** works too.

## First run

A two-screen guide explains the method and takes you straight to your first six. Allow
notifications when asked (or later in Settings) so the quiet nudges can reach you when the
window is closed. Six never makes a sound unless you switch one on in Settings.

## The day in Six

- **Evening:** plan tomorrow's six, most important at the top. Unfinished tasks are
  pre-filled so nothing is lost. Lock the list.
- **Morning:** task 1 is active. The timer runs from timestamps, so a sleeping laptop still
  records the truth. Mark it complete and task 2 takes over. Skipping ahead is possible, but
  Six asks twice and the last answer is a press-and-hold.
- **Focus:** start a pomodoro on the active task if you like. When it rings, take five, one
  more, or keep going. Leaving a task early is recorded as a fact, never a penalty.
- **Breaks:** Take 5 pauses the clock; a quiet banner asks you back.
- **End of day:** the review. What happened (facts only), what carries to tomorrow, and
  tomorrow's six. A one-line thought if you want one.
- **History and Stats:** the last 30 days, this week's numbers, a seven-day trend, the task
  that has rolled over the most, and a plain-text or JSON export.

## Menu bar

Six lives in the menu bar during the day: `1/6 · Draft the Q2 playbook`, or the day's state
when nothing is running. Left-click opens a small panel with the countdown and
Done · Take 5 · Defer; right-click gives Open Six · Plan tomorrow · Pause · Review today ·
Quit. Closing the window (Cmd+W) hides it there; the app keeps running until you quit
(Cmd+Q). If your menu bar is crowded (a MacBook with a notch), choose the compact style in
Settings.

## Keyboard

| Keys | Does |
|---|---|
| Space | Pause the active task (Take 5) or resume it |
| Cmd+N | Open the planner for the next unplanned day |
| Cmd+, | Settings |
| Cmd+W | Hide the window to the menu bar |
| Cmd+Q | Quit |

## Privacy and data

All data is one SQLite file at
`~/Library/Application Support/com.nikhiljois.six/six.db`. Exports go to
`~/Six/exports/`. Six makes no network requests of any kind. Deleting the app and that
folder removes everything.

## Build from source

You need Rust (stable, via rustup), Node 20+, pnpm, and the Xcode Command Line Tools.

```bash
git clone https://github.com/nikhiljoisr/six.git && cd six
pnpm install
pnpm build:mac
```

The app lands in `src-tauri/target/release/bundle/macos/Six.app`, signed ad-hoc with a
stable identifier (macOS needs that before it will ask about notifications). For a
universal build add the Intel target first:

```bash
rustup target add x86_64-apple-darwin && pnpm build:mac:universal
```

`pnpm tauri dev` runs the app with live reload (in-app banners work; OS notifications need
the packaged app). `cargo test` in `src-tauri` runs the Rust tests, which cover the whole
state machine.

Releases are built by GitHub Actions on a macOS runner: push a tag like `v1.1.0` and a
release with the zip appears.

## Design notes

Six is a Tauri v2 app: the Rust core owns every rule (the task state machine, timing,
streaks, nudges, the menu bar) and the React view only renders what Rust reports. The
original brief is in [`docs/SPEC.md`](docs/SPEC.md); every decision that departed from it
is dated in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Licence

MIT.
