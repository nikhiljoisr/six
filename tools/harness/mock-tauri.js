// A stand-in for Six's Rust core, so the real view can run in a plain browser or an
// offscreen web view. Development scaffolding: never bundled into the app.
//
// It models just enough of the day (plans, tasks, a pomodoro, a break) to render every
// screen and follow simple clicks. It is not the state machine; the Rust tests own that.
//
//   ?state=<name>      a seeded scene (see STATES below); default "idle"
//   ?win=popover       render the menu bar panel instead of the main window
//   ?phase=evening     after the evening hour (the clock reads 19:30 instead of 10:30)
//   ?set=key:value,…   override settings, e.g. ?set=pomodoro_minutes:50,countdown_line:false
//   ?motion=on         keep fades and transitions (off by default, so renders show settled states)
(() => {
  const q = new URLSearchParams(location.search);
  const label = q.get("win") === "popover" ? "popover" : "main";
  const evening = q.get("phase") === "evening";
  const stateName = q.get("state") || "idle";

  // A fixed clock, so renders repeat: Thursday 3 September 2026, advancing in real time.
  const T0 = new Date(2026, 8, 3, evening ? 19 : 10, 30, 0).getTime();
  const loaded = Date.now();
  const nowMs = () => T0 + (Date.now() - loaded);
  const iso = (offsetMs = 0) => new Date(nowMs() + offsetMs).toISOString();
  const at = (h, m, dayOffset = 0) => new Date(2026, 8, 3 + dayOffset, h, m, 0).toISOString();
  const TODAY = "2026-09-03";
  const TOMORROW = "2026-09-04";

  let seq = 0;
  let revision = 0;
  const id = (prefix) => `${prefix}-${++seq}`;
  const plans = {};
  const poms = []; // { task_id, started, planned, ended, outcome, ack }
  let brk = null;
  const settings = {
    evening_hour: 18,
    checkin_minutes: 75,
    break_minutes: 5,
    day_start_hour: 5,
    pomodoro_enabled: true,
    pomodoro_minutes: 25,
    long_break_minutes: 15,
    pomodoros_before_long_break: 4,
    tray_style: "full",
    sound_enabled: false,
    onboarded: true,
    nudge_style: "banner",
    countdown_line: true,
    global_shortcut: "off",
    tray_minutes: false,
    sound_style: "two_note",
    sound_level: "normal",
    appearance: "light",
    coach_enabled: false,
  };
  let returnGap = null; // the unanswered silence on the running session, if a scene seeds one
  let atLogin = false;
  for (const pair of (q.get("set") || "").split(",").filter(Boolean)) {
    const [key, raw] = pair.split(":");
    settings[key] = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
  }

  function mkPlan(date, rows) {
    const plan = {
      id: id("plan"),
      date,
      locked_at: null,
      edited_after_lock: false,
      reviewed_at: null,
      reflection: null,
      overrides: 0,
      idle_flags: [],
      jots: [], // { id, text, created_at, task_id }
      tasks: rows.map((r, i) => ({
        id: id("task"),
        position: i + 1,
        title: r.title,
        note: r.note ?? null,
        status: r.status ?? "planned",
        carried_from: r.carried_from ?? null,
        completed_at: r.completed_at ?? null,
        focus_seconds: r.focus ?? 0,
        session_started_at: null,
      })),
    };
    plans[date] = plan;
    return plan;
  }

  const isOpen = (t) => t.status === "planned" || t.status === "active" || t.status === "paused";
  const current = (p) => p && p.tasks.find((t) => t.status === "active" || t.status === "paused");
  function ensureActive(p) {
    if (!p.locked_at || p.date !== TODAY || current(p)) return;
    const next = p.tasks.find((t) => t.status === "planned");
    if (next) {
      next.status = "active";
      next.session_started_at = iso();
    }
  }
  const focusOf = (t) => t.focus_seconds + (t.session_started_at ? Math.floor((nowMs() - Date.parse(t.session_started_at)) / 1000) : 0);
  function closeSession(t) {
    t.focus_seconds = focusOf(t);
    t.session_started_at = null;
  }

  // ---- the pomodoro layer -------------------------------------------------------------
  function settle() {
    let rang = false;
    for (const p of poms) {
      if (!p.ended && p.started + p.planned * 1000 <= nowMs()) {
        p.ended = p.started + p.planned * 1000;
        p.outcome = "completed";
        rang = true;
      }
    }
    return rang;
  }
  function endPoms(taskId, outcome) {
    for (const p of poms) {
      if (p.task_id !== taskId) continue;
      if (!p.ended) {
        p.ended = nowMs();
        p.outcome = outcome;
      }
      if (!p.ack) p.ack = nowMs();
    }
  }
  const completedCount = (taskId) => poms.filter((p) => p.outcome === "completed" && (!taskId || p.task_id === taskId)).length;
  function pomState(plan) {
    const active = plan && plan.tasks.find((t) => t.status === "active");
    if (!active) return { phase: "idle", pom: null, task: null };
    const open = poms.find((p) => !p.ended && p.task_id === active.id);
    if (open) return { phase: "running", pom: open, task: active };
    const last = [...poms].reverse().find((p) => p.task_id === active.id);
    if (last && last.outcome === "completed" && !last.ack) return { phase: "done", pom: last, task: active };
    return { phase: "idle", pom: null, task: active };
  }
  function pomView(plan) {
    settle();
    const st = pomState(plan);
    const today = completedCount(null);
    return {
      enabled: settings.pomodoro_enabled,
      minutes: settings.pomodoro_minutes,
      break_minutes: settings.break_minutes,
      long_break_minutes: settings.long_break_minutes,
      set_size: settings.pomodoros_before_long_break,
      phase: settings.pomodoro_enabled ? st.phase : "idle",
      task_id: st.task ? st.task.id : null,
      started_at: st.pom ? new Date(st.pom.started).toISOString() : null,
      ends_at: st.pom ? new Date(st.pom.started + st.pom.planned * 1000).toISOString() : null,
      remaining_seconds: st.pom ? Math.max(0, Math.floor((st.pom.started + st.pom.planned * 1000 - nowMs()) / 1000)) : 0,
      completed_today: today,
      completed_for_task: st.task ? completedCount(st.task.id) : 0,
      long_break_next: today > 0 && today % settings.pomodoros_before_long_break === 0,
    };
  }

  // ---- the read model -----------------------------------------------------------------
  function view(p) {
    const done = p.tasks.filter((t) => t.status === "done").length;
    return {
      id: p.id,
      date: p.date,
      locked_at: p.locked_at,
      edited_after_lock: p.edited_after_lock,
      reviewed_at: p.reviewed_at,
      reflection: p.reflection,
      is_today: p.date === TODAY,
      task_count: p.tasks.length,
      done_count: done,
      all_done: p.tasks.length > 0 && done === p.tasks.length,
      total_focus_seconds: p.tasks.reduce((sum, t) => sum + focusOf(t), 0),
      pomodoros_completed: p.tasks.reduce((sum, t) => sum + completedCount(t.id), 0),
      tasks: p.tasks.map((t) => ({ ...t, focus_seconds: focusOf(t), pomodoros_completed: completedCount(t.id) })),
      jots: jotViews(p),
    };
  }
  const jotViews = (p) =>
    p.jots.map((j) => ({ id: j.id, text: j.text, created_at: j.created_at, position: p.tasks.find((t) => t.id === j.task_id)?.position ?? null }));
  const lockedDates = (before) =>
    Object.keys(plans)
      .filter((d) => plans[d].locked_at && (!before || d < before))
      .sort();
  /** The last locked day before today, when it has no review and is at most a week old. */
  function unreviewed() {
    const dates = lockedDates(TODAY);
    const p = plans[dates[dates.length - 1]];
    if (!p || p.reviewed_at) return null;
    const age = Math.round((new Date(`${TODAY}T00:00:00`) - new Date(`${p.date}T00:00:00`)) / 86400000);
    return age >= 1 && age <= 7 ? { plan_id: p.id, date: p.date } : null;
  }
  function carryover(date) {
    const dates = Object.keys(plans).filter((d) => d < date && plans[d].locked_at).sort();
    const from = dates[dates.length - 1];
    if (!from) return null;
    const tasks = plans[from].tasks
      .filter((t) => isOpen(t) || t.status === "deferred")
      .map((t) => ({ id: null, title: t.title, note: t.note, carried_from: t.id }));
    return tasks.length ? { from_date: from, tasks } : null;
  }
  function streak() {
    const locked = new Set(Object.values(plans).filter((p) => p.locked_at).map((p) => p.date));
    const shift = (d, n) => {
      const x = new Date(`${d}T00:00:00`);
      x.setDate(x.getDate() + n);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };
    let cursor = locked.has(TOMORROW) ? TOMORROW : locked.has(TODAY) ? TODAY : shift(TODAY, -1);
    let n = 0;
    while (locked.has(cursor)) {
      n++;
      cursor = shift(cursor, -1);
    }
    return n;
  }
  function snapshot() {
    const today = plans[TODAY];
    const tomorrow = plans[TOMORROW];
    return {
      revision: ++revision,
      today: TODAY,
      tomorrow: TOMORROW,
      now: iso(),
      phase: evening ? "after_evening" : "before_evening",
      settings: { ...settings },
      streak: streak(),
      today_plan: today ? view(today) : null,
      tomorrow_plan: tomorrow ? view(tomorrow) : null,
      carryover_preview: !today?.locked_at ? carryover(TODAY) : !tomorrow?.locked_at ? carryover(TOMORROW) : null,
      pomodoro: pomView(today),
      break: brk,
      unreviewed: unreviewed(),
      return_gap: returnGap,
    };
  }

  // ---- commands -----------------------------------------------------------------------
  const fail = (code, message) => {
    throw { code, message };
  };
  const byTask = (taskId) => {
    for (const p of Object.values(plans)) {
      const t = p.tasks.find((x) => x.id === taskId);
      if (t) return [p, t];
    }
    return fail("task_not_found", "task not found");
  };
  const byPlan = (planId) => Object.values(plans).find((p) => p.id === planId) || fail("plan_not_found", "list not found");
  const listeners = {};
  const callbacks = {};
  function emit(event, payload, target) {
    for (const l of listeners[event] || []) {
      const any = !l.target || l.target.kind === "Any";
      if ((any || l.target.label === target) && callbacks[l.handler]) callbacks[l.handler]({ event, id: l.handler, payload });
    }
  }
  const publish = () => emit("state_changed", snapshot());
  const BOOLEAN_SETTINGS = ["pomodoro_enabled", "sound_enabled", "onboarded", "countdown_line", "tray_minutes", "coach_enabled"];
  const TEXT_SETTINGS = ["tray_style", "nudge_style", "global_shortcut", "sound_style", "sound_level", "appearance"];

  const commands = {
    get_snapshot: () => snapshot(),
    get_settings: () => ({ ...settings }),
    get_streak: () => streak(),
    get_carryover: ({ date }) => carryover(date),
    get_day: ({ date }) => (plans[date] ? view(plans[date]) : null),
    get_range: ({ from, to }) =>
      Object.values(plans)
        .filter((p) => p.date >= from && p.date <= to)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(view),
    draft_plan: ({ date, tasks }) => {
      if (tasks.length > 6) fail("too_many_tasks", "a list holds at most six tasks");
      if (plans[date]) return commands.edit_plan({ plan_id: plans[date].id, tasks });
      mkPlan(date, tasks);
      return snapshot();
    },
    lock_plan: ({ plan_id }) => {
      const p = byPlan(plan_id);
      if (p.locked_at) fail("already_locked", "the list is already locked");
      p.locked_at = iso();
      ensureActive(p);
      return snapshot();
    },
    edit_plan: ({ plan_id, tasks }) => {
      const p = byPlan(plan_id);
      if (tasks.length > 6) fail("too_many_tasks", "a list holds at most six tasks");
      p.tasks = tasks.map((r, i) => {
        const kept = r.id && p.tasks.find((t) => t.id === r.id);
        return kept
          ? { ...kept, position: i + 1, title: r.title, note: r.note ?? null }
          : { id: id("task"), position: i + 1, title: r.title, note: r.note ?? null, status: "planned", carried_from: r.carried_from ?? null, completed_at: null, focus_seconds: 0, session_started_at: null };
      });
      if (p.locked_at) p.edited_after_lock = true;
      ensureActive(p);
      return snapshot();
    },
    activate: ({ task_id, override_order }) => {
      const [p, t] = byTask(task_id);
      if (t.status !== "planned") fail("invalid_transition", `cannot start a task that is ${t.status}`);
      const ahead = p.tasks.some((o) => o.position < t.position && isOpen(o));
      if (ahead && !override_order) fail("needs_override", "an earlier task is unfinished; skipping ahead needs an override");
      if (ahead) p.overrides += 1;
      for (const o of p.tasks.filter((x) => x.status === "active" || x.status === "paused")) {
        endPoms(o.id, "interrupted");
        closeSession(o);
        o.status = "planned";
      }
      brk = null;
      t.status = "active";
      t.session_started_at = iso();
      return snapshot();
    },
    complete: ({ task_id }) => {
      const [p, t] = byTask(task_id);
      if (t.status !== "active" && t.status !== "paused") fail("invalid_transition", `cannot complete a task that is ${t.status}`);
      endPoms(t.id, "finished_early");
      closeSession(t);
      t.status = "done";
      t.completed_at = iso();
      brk = null;
      ensureActive(p);
      return snapshot();
    },
    reopen: ({ task_id }) => {
      const [p, t] = byTask(task_id);
      t.status = "planned";
      t.completed_at = null;
      ensureActive(p);
      return snapshot();
    },
    pause: ({ task_id, reason }) => {
      const [, t] = byTask(task_id);
      endPoms(t.id, "interrupted");
      closeSession(t);
      t.status = "paused";
      brk = reason === "break" ? { started_at: iso(), ends_at: iso(settings.break_minutes * 60000), minutes: settings.break_minutes, long: false } : null;
      return snapshot();
    },
    resume: ({ task_id }) => {
      const [, t] = byTask(task_id);
      t.status = "active";
      t.session_started_at = iso();
      brk = null;
      return snapshot();
    },
    defer: ({ task_id }) => {
      const [p, t] = byTask(task_id);
      endPoms(t.id, "interrupted");
      closeSession(t);
      t.status = "deferred";
      brk = null;
      ensureActive(p);
      return snapshot();
    },
    skip: ({ task_id }) => {
      const [p, t] = byTask(task_id);
      closeSession(t);
      t.status = "skipped";
      ensureActive(p);
      return snapshot();
    },
    set_note: ({ task_id, note }) => {
      byTask(task_id)[1].note = note;
      return snapshot();
    },
    touch: () => true,
    add_jot: ({ text }) => {
      const p = plans[TODAY];
      if (!p || !p.locked_at) fail("no_list", "there is no list for today to park a thought on");
      const line = String(text).split(/\s+/).filter(Boolean).join(" ").slice(0, 200);
      if (!line) fail("empty_jot", "a parked thought needs some words");
      if (p.jots.length >= 30) fail("too_many_jots", "that is the day's limit for parked thoughts");
      p.jots.push({ id: id("jot"), text: line, created_at: iso(), task_id: current(p)?.id ?? null });
      return snapshot();
    },
    remove_jot: ({ jot_id }) => {
      for (const p of Object.values(plans)) p.jots = p.jots.filter((j) => j.id !== jot_id);
      return snapshot();
    },
    keep_gap: () => {
      returnGap = null;
      return snapshot();
    },
    trim_return_gap: ({ session_id }) => {
      if (!returnGap || returnGap.session_id !== session_id) fail("invalid_trim", "there is no silence to take out");
      return commands.trim_session({ session_id });
    },
    coach_status: () => ({ enabled: settings.coach_enabled, key_present: settings.coach_enabled }),
    // Keyword rules standing in for TypeSafe: enough to show every kind of hint.
    coach_plan: ({ titles }) => {
      if (!settings.coach_enabled) fail("coach_off", "the planning coach is switched off in Settings");
      harness.lastCoachTitles = titles;
      return {
        hints: titles.map((title, i) => {
          const twin = titles.findIndex((other, j) => j < i && /accountant/i.test(other) && /accountant/i.test(title));
          if (twin >= 0) return { kind: "same_as", row: twin + 1 };
          if (/ and decide |;/.test(title)) return { kind: "two_tasks" };
          if (/^(work on|think about|look into)/i.test(title)) return { kind: "no_finish" };
          if (/end to end|rewrite|migrate/i.test(title)) return { kind: "most_of_a_day" };
          return null;
        }),
      };
    },
    get_autostart: () => atLogin,
    set_autostart: ({ enabled }) => (atLogin = !!enabled),
    get_elapsed: () => {
      const p = plans[TODAY];
      const t = current(p);
      if (!t) return null;
      if (settle()) publish();
      const st = pomState(p);
      return {
        task_id: t.id,
        status: t.status,
        focus_seconds: focusOf(t),
        pomodoro: settings.pomodoro_enabled ? st.phase : "idle",
        pomodoro_remaining: st.pom ? Math.max(0, Math.floor((st.pom.started + st.pom.planned * 1000 - nowMs()) / 1000)) : 0,
        on_break: !!brk,
        break_remaining: brk ? Math.max(0, Math.floor((Date.parse(brk.ends_at) - nowMs()) / 1000)) : 0,
      };
    },
    start_pomodoro: ({ task_id }) => {
      if (!settings.pomodoro_enabled) fail("pomodoro_off", "Pomodoro is switched off in Settings");
      const [, t] = byTask(task_id);
      if (t.status !== "active") fail("invalid_transition", "a pomodoro runs on the active task");
      endPoms(t.id, "interrupted");
      poms.push({ task_id: t.id, started: nowMs(), planned: settings.pomodoro_minutes * 60, ended: null, outcome: null, ack: null });
      return snapshot();
    },
    acknowledge_pomodoro: ({ task_id }) => {
      settle();
      for (const p of poms) if (p.task_id === task_id && p.outcome === "completed" && !p.ack) p.ack = nowMs();
      return snapshot();
    },
    get_review: ({ plan_id }) => {
      const p = byPlan(plan_id);
      const top = p.tasks.filter((t) => t.position <= 3);
      return {
        plan: view(p),
        top_three_done: top.length > 0 && top.every((t) => t.status === "done"),
        overrides: p.overrides,
        idle_flags: p.idle_flags,
        unfinished: p.tasks.filter(isOpen).map((t) => t.id),
        still_carries: [TODAY, TOMORROW].some((target) => !plans[target]?.locked_at && lockedDates(target).pop() === p.date),
        jots: jotViews(p),
      };
    },
    trim_session: ({ session_id }) => {
      if (returnGap && returnGap.session_id === session_id) {
        const task = byTask(returnGap.task_id)[1];
        task.focus_seconds = Math.max(0, task.focus_seconds - returnGap.gap_seconds);
        returnGap = null;
        return snapshot();
      }
      for (const p of Object.values(plans)) {
        const flag = p.idle_flags.find((f) => f.session_id === session_id);
        if (!flag) continue;
        const task = p.tasks.find((t) => t.id === flag.task_id);
        task.focus_seconds = Math.max(0, task.focus_seconds - flag.gap_seconds);
        p.idle_flags = p.idle_flags.filter((f) => f !== flag);
      }
      return snapshot();
    },
    complete_review: ({ plan_id, reflection, decisions }) => {
      const p = byPlan(plan_id);
      if (p.reviewed_at) fail("already_reviewed", "the review for this day is already recorded");
      for (const t of p.tasks.filter(isOpen)) {
        const decision = (decisions || []).find((d) => d.task_id === t.id)?.decision || "carry";
        closeSession(t);
        t.status = decision === "carry" ? "deferred" : "skipped";
      }
      brk = null;
      p.reviewed_at = iso();
      p.reflection = reflection || null;
      return snapshot();
    },
    set_setting: ({ key, value }) => {
      if (BOOLEAN_SETTINGS.includes(key)) settings[key] = value === "1" || value === "true";
      else if (TEXT_SETTINGS.includes(key)) settings[key] = value;
      else if (key in settings) settings[key] = Number(value);
      else fail("unknown_setting", `unknown setting: ${key}`);
      return snapshot();
    },
    get_stats: ({ from, to }) => {
      const inRange = Object.values(plans).filter((p) => p.locked_at && p.date >= from && p.date <= to);
      const trend = [];
      const end = new Date(`${to}T00:00:00`);
      for (let d = new Date(`${from}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const p = plans[date];
        const planned = !!(p && p.locked_at);
        trend.push({
          date,
          planned,
          tasks_total: planned ? p.tasks.length : 0,
          tasks_done: planned ? p.tasks.filter((t) => t.status === "done").length : 0,
          focus_seconds: planned ? p.tasks.reduce((sum, t) => sum + focusOf(t), 0) : 0,
          pomodoros: 0,
        });
      }
      const all = inRange.flatMap((p) => p.tasks);
      const done = (ts) => ts.filter((t) => t.status === "done").length;
      const top = all.filter((t) => t.position <= 3);
      const rest = all.filter((t) => t.position > 3);
      return {
        from,
        to,
        days_in_range: trend.length,
        days_planned: inRange.length,
        tasks_total: all.length,
        tasks_done: done(all),
        top3_total: top.length,
        top3_done: done(top),
        rest_total: rest.length,
        rest_done: done(rest),
        focus_seconds: all.reduce((sum, t) => sum + focusOf(t), 0),
        pomodoros: completedCount(null),
        pomodoros_interrupted: poms.filter((p) => p.outcome === "interrupted").length,
        overrides: inRange.reduce((sum, p) => sum + p.overrides, 0),
        days_reviewed: inRange.filter((p) => p.reviewed_at).length,
        days_reviewable: inRange.filter((p) => p.date < TODAY || p.reviewed_at).length,
        by_position: [1, 2, 3, 4, 5, 6].map((position) => {
          const at = all.filter((t) => t.position === position);
          return { position, total: at.length, done: done(at) };
        }),
        trend,
        most_carried: { title: "Draft Q2 playbook outline", days: 3 },
      };
    },
    export_range: ({ from, to }) => ({ paths: [`/Users/you/Six/exports/six-${from}_${to}.txt`, `/Users/you/Six/exports/six-${from}_${to}.json`], dir: "/Users/you/Six/exports" }),
    export_all: () => ({ paths: [`/Users/you/Six/exports/six-all-${TODAY}.json`], dir: "/Users/you/Six/exports" }),
    notification_status: () => ({ available: true, permission: "prompt" }),
    request_notification_permission: () => ({ available: true, permission: "granted" }),
    get_app_info: () => ({ version: "harness", data_dir: "/Users/you/Library/Application Support/com.nikhiljois.six", exports_dir: "/Users/you/Six/exports", backups_dir: "/Users/you/Library/Application Support/com.nikhiljois.six/backups", platform: "macos" }),
    nudge_action: ({ kind, action, task_id }) => {
      harness.lastNudgeAction = { kind, action, task_id };
      const t = current(plans[TODAY]);
      if (task_id && (!t || t.id !== task_id)) fail("stale_nudge", "the task this nudge was about has moved on");
      if (action === "done" && t) return commands.complete({ task_id: t.id });
      if (action === "resume" && t) return commands.resume({ task_id: t.id });
      if (action === "take_break" && t) return commands.pause({ task_id: t.id, reason: "break" });
      if (action === "one_more" && t) return commands.start_pomodoro({ task_id: t.id });
      if (action === "keep_going" && t) return commands.acknowledge_pomodoro({ task_id: t.id });
      return snapshot();
    },
    snooze: () => snapshot(),
    show_main: ({ target }) => {
      harness.lastShowMain = target;
      return null;
    },
    hide_popover: () => null,
    show_banner: () => null,
    size_popover: ({ height }) => {
      harness.popoverHeight = height;
      return null;
    },
    "plugin:event|listen": ({ event, handler, target }) => {
      (listeners[event] = listeners[event] || []).push({ handler, target });
      return handler;
    },
    "plugin:event|unlisten": () => null,
  };

  const inFlight = new Set();
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args = {}) =>
      new Promise((resolve, reject) => {
        const run = harness.overrides[cmd] || commands[cmd];
        if (!run) return reject({ code: "unknown_command", message: `the harness has no ${cmd}` });
        // Answer in a later task, as real IPC does (a microtask would let a whole save
        // finish between two listeners of one key event). A message channel, not a timer:
        // timers are throttled in a hidden page.
        // The channel is held until it has delivered: WebKit may collect one that nothing
        // refers to, and the answer would never come.
        const channel = new MessageChannel();
        inFlight.add(channel);
        channel.port1.onmessage = () => {
          inFlight.delete(channel);
          try {
            resolve(run(args));
          } catch (e) {
            reject(e);
          }
        };
        channel.port2.postMessage(0);
      }),
    transformCallback: (callback) => {
      const n = ++seq;
      callbacks[n] = callback;
      return n;
    },
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label } },
    convertFileSrc: (path) => path,
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  const harness = (window.__SIX_HARNESS__ = { plans, poms, settings, snapshot, emit, publish, commands, overrides: {}, nowMs });

  // ---- seeded scenes ------------------------------------------------------------------
  const done = (plan, when) => plan.tasks.forEach((t) => Object.assign(t, { status: "done", completed_at: when }));
  const day1 = mkPlan("2026-09-01", [
    { title: "Ship the pricing page", focus: 5400 },
    { title: "Call the accountant", focus: 900 },
    { title: "Review the Q3 plan", focus: 3600 },
    { title: "Reply to Priya", focus: 600 },
    { title: "Book flights", focus: 300 },
    { title: "Gym", focus: 2700 },
  ]);
  Object.assign(day1, { locked_at: at(18, 30, -3), reviewed_at: at(18, 40, -2), reflection: "Best day this month. The pricing page is finally out." });
  done(day1, at(16, 0, -2));
  const day2 = mkPlan("2026-09-02", [
    { title: "Write the investor update", focus: 7200, status: "done", completed_at: at(11, 0, -1) },
    { title: "Fix the onboarding bug", focus: 4500, status: "done", completed_at: at(13, 30, -1) },
    { title: "Prepare board slides", focus: 1800, status: "done", completed_at: at(16, 0, -1) },
    { title: "Clear the inbox", status: "skipped" },
    { title: "Draft Q2 playbook outline", note: "Start from last year's doc", status: "deferred" },
    { title: "Renew the domain" },
  ]);
  Object.assign(day2, { locked_at: at(18, 20, -2), reviewed_at: at(18, 30, -1), reflection: "Board slides took longer than planned." });

  const six = mkPlan(TODAY, [
    { title: "Send the Q3 numbers to Priya", focus: 5400, status: "done", completed_at: iso(-3600000) },
    { title: "Draft the opening section of the deck", note: "Start from last quarter's version", focus: 2700, status: "active" },
    { title: "Call the accountant about the filing" },
    { title: "Reply to the hiring thread" },
    { title: "Book the dentist" },
    { title: "Clear the inbox to zero" },
  ]);
  six.locked_at = iso(-3 * 3600000);
  const second = six.tasks[1];
  second.session_started_at = iso();

  const later = (ms, fn) => setTimeout(fn, ms);
  const nav = (target) => later(400, () => emit("navigate", target, "main"));
  const click = (text) => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
    if (button) button.click();
  };
  const clickStarting = (text) => {
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith(text));
    if (button) button.click();
  };
  const park = (plan, text, when, task) => plan.jots.push({ id: id("jot"), text, created_at: when, task_id: task ? task.id : null });
  /** Yesterday ended without its review: one task never started, one deferred, two thoughts parked. */
  const yesterdayUnreviewed = () => {
    Object.assign(day2, { reviewed_at: null, reflection: null });
    park(day2, "Ask Priya whether the board wants the long deck", at(11, 20, -1), day2.tasks[1]);
    park(day2, "Renew the passport before November", at(15, 5, -1), day2.tasks[2]);
  };
  const type = (selector, text) => {
    const input = document.querySelector(selector);
    if (!input) return;
    const kind = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(kind.prototype, "value").set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const startPom = (agoMs) => poms.push({ task_id: second.id, started: nowMs() - agoMs, planned: 1500, ended: null, outcome: null, ack: null });
  const rungPom = () => {
    const rang = nowMs();
    poms.push({ task_id: second.id, started: rang - 1500000, planned: 1500, ended: rang, outcome: "completed", ack: null });
    return new Date(rang).toISOString();
  };
  const pauseSecond = () => Object.assign(second, { status: "paused", session_started_at: null });
  const tomorrowsSix = () => {
    const plan = mkPlan(TOMORROW, [
      { title: "Call the accountant about the filing", carried_from: six.tasks[2].id },
      { title: "Write the investor update" },
      { title: "Fix the onboarding bug" },
      { title: "Prepare board slides" },
      { title: "Renew the domain" },
      { title: "Gym" },
    ]);
    plan.locked_at = iso(-600000);
    return plan;
  };
  const ringNudge = (due) => ({
    kind: "pomodoro_done",
    due,
    title: "Pomodoro finished.",
    body: "Task time is still recording.",
    actions: [
      { id: "take_break", label: "Break 5 min" },
      { id: "one_more", label: "Another 25 min" },
      { id: "keep_going", label: "Continue without timer" },
    ],
    task_id: second.id,
  });

  const STATES = {
    // The day view
    idle() {},
    running: () => startPom(772000),
    ring: () => void rungPom(),
    paused: pauseSecond,
    break() {
      pauseSecond();
      brk = { started_at: iso(-108000), ends_at: iso(192000), minutes: 5, long: false };
    },
    "break-over"() {
      pauseSecond();
      brk = { started_at: iso(-480000), ends_at: iso(-180000), minutes: 5, long: false };
    },
    "no-pomodoro": () => void (settings.pomodoro_enabled = false),
    morning() {
      delete plans[TODAY];
    },
    long() {
      second.title = "Draft the opening section of the deck for the board, with the revised numbers from finance and the new hiring plan";
      second.note = "Start from last quarter's version, keep the three-slide structure, and leave the appendix for Priya to fill in after the accountant confirms the filing";
      six.tasks[2].status = "deferred";
      six.tasks[3].status = "skipped";
      six.tasks[4].title = "Reply to the hiring thread about the two senior candidates and the contractor question";
      startPom(772000);
    },
    "six-done"() {
      six.tasks.forEach((t) => Object.assign(t, { status: "done", completed_at: iso(-600000), session_started_at: null }));
    },
    "tomorrow-planned": tomorrowsSix,
    edited: () => void (six.edited_after_lock = true),
    // Back at 10:30 after nothing since 06:15 on the running task.
    "return-gap"() {
      second.focus_seconds = 900;
      second.session_started_at = at(6, 0);
      returnGap = {
        session_id: "session-7",
        task_id: second.id,
        started_at: at(6, 0),
        ended_at: iso(),
        seconds: 4 * 3600 + 30 * 60,
        gap_start: at(6, 15),
        gap_end: at(10, 29),
        gap_seconds: 4 * 3600 + 14 * 60,
        suggested_seconds: 16 * 60,
      };
    },
    // The field is filled and left at once: a focused text field makes an offscreen web
    // view wait on the system's spelling service, and the render times out.
    jot() {
      later(700, () => click("Jot"));
      later(1100, () => {
        type('input[aria-label^="Park a thought"]', "Ask Priya whether the board wants the long deck");
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
    },
    "morning-unreviewed"() {
      delete plans[TODAY];
      yesterdayUnreviewed();
    },
    banner() {
      later(600, () =>
        emit(
          "nudge",
          {
            kind: "check_in",
            due: iso(),
            title: "Still on Draft the opening section of the deck?",
            body: "1 h 15 min recorded so far.",
            actions: [
              { id: "done", label: "Done" },
              { id: "keep_going", label: "Continue" },
              { id: "take_break", label: "Break 5 min" },
            ],
            task_id: second.id,
          },
          "main",
        ),
      );
    },
    "skip-1": () => later(700, () => click("skip ahead")),
    "skip-2"() {
      later(700, () => click("skip ahead"));
      later(1200, () => click("Skip ahead"));
    },
    "skip-3"() {
      later(700, () => click("skip ahead"));
      later(1200, () => click("Skip ahead"));
      later(1700, () => click("Yes, still sure"));
    },
    // The planner
    "planner-today": () => nav({ name: "planner", date: TODAY }),
    "planner-tomorrow": () => nav({ name: "planner", date: TOMORROW }),
    "planner-empty"() {
      six.tasks.forEach((t) => Object.assign(t, { status: "done", completed_at: iso(-600000), session_started_at: null }));
      nav({ name: "planner", date: TOMORROW });
    },
    "planner-error"() {
      harness.overrides.edit_plan = () => fail("db", "could not write six.db: disk full");
      nav({ name: "planner", date: TODAY });
      later(1200, () => type('[aria-label="Task 3"]', "Call the accountant, then the bank"));
      later(1600, () => click("Save changes"));
    },
    "planner-pending"() {
      harness.overrides.edit_plan = () => new Promise(() => {});
      nav({ name: "planner", date: TODAY });
      later(1200, () => click("Save changes"));
    },
    // Long titles in the planner: every one is in view, wrapped.
    "planner-long"() {
      STATES.long();
      poms.length = 0;
      nav({ name: "planner", date: TODAY });
    },
    // The planning coach, switched on and asked: a list with one of each remark.
    "planner-coach"() {
      settings.coach_enabled = true;
      const titles = [
        "Send the Q3 numbers to Priya",
        "Rewrite the onboarding flow end to end",
        "Clean up the vendor list and decide whether to merge it with the CRM",
        "Work on the website",
        "Call the accountant about the filing",
        "Ring the accountant re: tax filing",
      ];
      six.tasks.forEach((t, i) => Object.assign(t, { title: titles[i], note: null }));
      nav({ name: "planner", date: TODAY });
      later(1200, () => click("Check the list"));
    },
    // The review
    "review-1"() {
      six.tasks[0].focus_seconds = 7 * 3600;
      six.idle_flags = [
        {
          session_id: "session-1",
          task_id: six.tasks[0].id,
          started_at: at(21, 0, -1),
          ended_at: at(4, 0),
          seconds: 7 * 3600,
          gap_start: at(22, 30, -1),
          gap_end: at(2, 30),
          gap_seconds: 4 * 3600,
          suggested_seconds: 3 * 3600,
        },
      ];
      nav({ name: "review", planId: six.id });
    },
    "review-2"() {
      tomorrowsSix();
      nav({ name: "review", planId: six.id });
      later(1200, () => click("Next"));
    },
    // Today's review with thoughts parked during the day.
    "review-jots"() {
      park(six, "Ask Priya whether the board wants the long deck", iso(-5400000), six.tasks[0]);
      park(six, "Renew the passport before November", iso(-1200000), second);
      nav({ name: "review", planId: six.id });
    },
    // A day that ended without a review. Still the latest list: what was left is asked about.
    "review-past"() {
      delete plans[TODAY];
      yesterdayUnreviewed();
      nav({ name: "review", planId: day2.id });
    },
    "review-past-2"() {
      delete plans[TODAY];
      yesterdayUnreviewed();
      nav({ name: "review", planId: day2.id });
      later(1200, () => click("Next"));
    },
    // The same day once today's list is locked: one screen, nothing to carry or drop.
    "review-later"() {
      yesterdayUnreviewed();
      nav({ name: "review", planId: day2.id });
    },
    // Evening, tomorrow already planned, yesterday not reviewed: the tallest no-list screen.
    "evening-planned-unreviewed"() {
      delete plans[TODAY];
      yesterdayUnreviewed();
      tomorrowsSix();
    },
    // Tomorrow was planned first; today is not planned, so yesterday still feeds today's planner.
    "review-past-tomorrow-set"() {
      delete plans[TODAY];
      yesterdayUnreviewed();
      tomorrowsSix();
      nav({ name: "review", planId: day2.id });
    },
    "history-open"() {
      yesterdayUnreviewed();
      park(six, "Renew the passport before November", iso(-1200000), second);
      nav({ name: "history" });
      later(1200, () => clickStarting("Wednesday"));
    },
    history: () => nav({ name: "history" }),
    stats: () => nav({ name: "stats" }),
    settings: () => nav({ name: "settings" }),
    "welcome-1": () => void (settings.onboarded = false),
    "welcome-2"() {
      settings.onboarded = false;
      later(700, () => click("Next"));
    },
    // The menu bar panel (use with ?win=popover)
    "panel-ring-banner"() {
      const due = rungPom();
      later(600, () => emit("popover_nudge", ringNudge(due), "popover"));
    },
    "panel-break-over-banner"() {
      STATES["break-over"]();
      later(600, () =>
        emit(
          "popover_nudge",
          {
            kind: "break_over",
            due: iso(),
            title: "Back to Draft the opening section of the deck?",
            body: "Task time is paused until you resume.",
            actions: [
              { id: "resume", label: "Resume" },
              { id: "snooze", label: "5 more minutes" },
            ],
            task_id: second.id,
          },
          "popover",
        ),
      );
    },
  };
  // An offscreen web view never advances animations, so a render would catch a fade at
  // its first frame. Scenes show settled states: motion is off unless ?motion=on.
  if (q.get("motion") !== "on") {
    const still = document.createElement("style");
    still.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
    document.head.appendChild(still);
  }

  harness.states = Object.keys(STATES);
  const seed = STATES[stateName];
  if (seed) seed();
  else console.warn(`[harness] no state named "${stateName}"; showing "idle". Known: ${harness.states.join(", ")}`);
})();
