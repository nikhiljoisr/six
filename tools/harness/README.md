# The view harness

Six's view only renders what the Rust core reports, so it can run against a stand-in
core in a plain browser. This folder is that stand-in, plus a renderer that turns every
seeded scene into a PNG at the real window sizes. It is how a change to the interface
gets looked at before it ships. Nothing here is bundled into the app.

```bash
pnpm build
node tools/harness/serve.mjs          # then open http://127.0.0.1:4173/?state=running
node tools/harness/shots.mjs          # every scene, into tools/harness/out/
node tools/harness/shots.mjs --only day-running,panel-ring --out /tmp/shots
node tools/harness/shots.mjs --batch 2   # fewer at once, for a busy machine
```

- `mock-tauri.js` models plans, tasks, one pomodoro and a break, on a fixed clock
  (Thursday 3 September 2026, 10:30; `?phase=evening` makes it 19:30) so renders repeat.
  It follows simple clicks, but it is not the state machine: the Rust tests own the rules.
- `?state=<name>` picks a scene, `?win=popover` the menu bar panel, and
  `?set=key:value,…` overrides settings (`?set=pomodoro_minutes:50`).
- Fades and transitions are switched off in the harness (`?motion=on` keeps them): an
  offscreen web view never advances an animation, so a render would catch a fade at its
  first, invisible frame.
- A render is tried up to eight times, with a pause between: WebKit's snapshot can fail outright when the
  machine is starved. A scene that leaves a text field focused can stall an offscreen
  web view on the system's spelling service, so scenes fill a field and leave it.
- `render.swift` loads a URL in an offscreen WKWebView and writes a 2x PNG. It needs only
  the Xcode command line tools and works with the screen locked. `--dark` renders with the
  system's dark appearance.
- The main window is rendered at 480×532 points: the window is 560 tall, and the title bar
  takes 28 of that. A layout that fits a 560 render can still overflow the real window.

When the read model changes (`src/lib/types.ts`), change `mock-tauri.js` with it.
