import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement } from "react";
import { Button, Label, Rule } from "../components/ui";
import { api } from "../lib/api";
import { hourLabel, tildePath } from "../lib/format";
import { backFrom } from "../lib/nav";
import { chime } from "../lib/sound";
import type { AppInfo, DaySnapshot, GlobalShortcut, NotificationStatus, Settings as SettingsView } from "../lib/types";
import { useStore } from "../store";

// A minimal screen (SPEC §4.9). Every value is saved as it changes; Rust validates.

export function Settings({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const previous = useStore((s) => s.previous);
  const dispatch = useStore((s) => s.dispatch);
  const s = snapshot.settings;
  // Back returns to wherever Settings was opened from.
  const back = backFrom({ name: "settings" }, previous) ?? { name: "history" as const };
  const [notif, setNotif] = useState<NotificationStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  // Opening at login is macOS's to remember, not Six's: asked for, never mirrored in settings.
  const [atLogin, setAtLogin] = useState<boolean | null>(null);
  const [loginProblem, setLoginProblem] = useState<string | null>(null);

  useEffect(() => {
    api.notificationStatus().then(setNotif).catch(() => setNotif({ available: false, permission: "unavailable" }));
    api.getAppInfo().then(setInfo).catch(() => setInfo(null));
    api.getAutostart().then(setAtLogin).catch(() => setAtLogin(null));
  }, []);

  const openAtLogin = async (on: boolean) => {
    try {
      setAtLogin(await api.setAutostart(on));
      setLoginProblem(null);
    } catch (e) {
      setLoginProblem((e as { message?: string })?.message ?? "macOS did not accept the change.");
    }
  };

  const set = (key: keyof SettingsView, value: string | number | boolean) =>
    void dispatch(() => api.setSetting(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value)));

  const askPermission = async () => {
    try {
      setNotif(await api.requestNotificationPermission());
    } catch {
      /* shown as unavailable */
    }
  };

  const exportAll = async () => {
    try {
      const r = await api.exportAll();
      setExported(`Saved to ${(r.paths[0] ? tildePath(r.paths[0]) : r.dir)}`);
    } catch (e) {
      setExported((e as { message?: string })?.message ?? "Export failed.");
    }
  };

  const permissionWord: Record<string, string> = {
    granted: "Allowed",
    denied: "Denied in System Settings",
    prompt: "Not asked yet",
    unavailable: "Unavailable in this build",
  };

  return (
    <div className="pb-16 pl-8 pr-0 pt-2">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <h1 className="font-serif text-[15px] font-normal text-stone-900">Settings</h1>
        <nav className="flex shrink-0 items-baseline gap-4 whitespace-nowrap font-sans text-[12px] text-stone-500">
          <button type="button" className="hover:text-stone-900" onClick={() => navigate(back)}>
            Back
          </button>
        </nav>
      </header>
      <Rule className="mt-3" />

      <Section title="The day">
        <Row label="Evening ritual" hint={`Plan tomorrow after ${hourLabel(s.evening_hour)}.`}>
          <HourSelect value={s.evening_hour} onChange={(v) => set("evening_hour", v)} />
        </Row>
        <Row label="Day starts at" hint="Late-night work counts toward the evening before.">
          <HourSelect value={s.day_start_hour} onChange={(v) => set("day_start_hour", v)} />
        </Row>
        <Row label="Check-in after" hint="Minutes into a session before the nudge.">
          <NumberField value={s.checkin_minutes} min={5} max={480} onChange={(v) => set("checkin_minutes", v)} suffix="min" />
        </Row>
        <Row label="Break length" hint="Take 5, or however long you like.">
          <NumberField value={s.break_minutes} min={1} max={60} onChange={(v) => set("break_minutes", v)} suffix="min" />
        </Row>
      </Section>

      <Section title="Pomodoro">
        <Row label="Work in pomodoros" hint="A countdown on the active task, a silent ring at the end.">
          <Toggle value={s.pomodoro_enabled} onChange={(v) => set("pomodoro_enabled", v)} />
        </Row>
        <Row label="Pomodoro length">
          <NumberField value={s.pomodoro_minutes} min={1} max={180} onChange={(v) => set("pomodoro_minutes", v)} suffix="min" />
        </Row>
        <Row label="Long break">
          <NumberField value={s.long_break_minutes} min={1} max={120} onChange={(v) => set("long_break_minutes", v)} suffix="min" />
        </Row>
        <Row label="Long break after">
          <NumberField value={s.pomodoros_before_long_break} min={1} max={12} onChange={(v) => set("pomodoros_before_long_break", v)} suffix="pomodoros" />
        </Row>
        <Row label="Sound when a pomodoro or break ends" hint="Off by default. Six is otherwise silent.">
          <Toggle value={s.sound_enabled} onChange={(v) => set("sound_enabled", v)} />
        </Row>
        {s.sound_enabled && (
          <Row label="Which sound" hint="Choosing one plays it.">
            <span className="flex items-center gap-2">
              <select
                value={s.sound_style}
                aria-label="Which sound"
                onChange={(e) => {
                  chime(e.target.value, s.sound_level);
                  set("sound_style", e.target.value);
                }}
                className={SELECT}
              >
                <option value="two_note">Two notes</option>
                <option value="bell">Bell</option>
                <option value="knock">Knock</option>
              </select>
              <select
                value={s.sound_level}
                aria-label="How loud"
                onChange={(e) => {
                  chime(s.sound_style, e.target.value);
                  set("sound_level", e.target.value);
                }}
                className={SELECT}
              >
                <option value="soft">Soft</option>
                <option value="normal">Normal</option>
                <option value="loud">Loud</option>
              </select>
            </span>
          </Row>
        )}
        <Row label="Line under the countdown" hint="A thin line showing what remains of the pomodoro, in the window and the menu bar panel.">
          <Toggle value={s.countdown_line} onChange={(v) => set("countdown_line", v)} />
        </Row>
      </Section>

      <Section title="Keyboard">
        <Row label="From anywhere" hint="Shows or hides Six from any app.">
          <select
            value={s.global_shortcut}
            onChange={(e) => set("global_shortcut", e.target.value)}
            className="h-7 rounded-control border border-stone-200 bg-white px-2 text-[13px] text-stone-900 focus:border-stone-400 focus:outline-none"
          >
            {(Object.keys(SHORTCUT_NAMES) as GlobalShortcut[]).map((k) => (
              <option key={k} value={k}>
                {SHORTCUT_NAMES[k]}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Space" hint="Take a break, or resume." />
        <Row label="Cmd+Return" hint="Complete the active task. In the planner, save the list." />
        <Row label="P" hint="Start a pomodoro on the active task." />
        <Row label="J" hint="Park a thought for the evening review. A thought, not a task." />
        <Row label="Space or Return, held" hint="The last step of skipping ahead." />
        <Row label="Return" hint="In the planner, move to the next row." />
        <Row label="Option+↑ or ↓" hint="In the planner, move the row up or down." />
        <Row label="Cmd+E" hint="Edit today's list." />
        <Row label="Cmd+N" hint="Plan the next unplanned day." />
        <Row label="Cmd+," hint="Settings." />
        <Row label="Esc" hint="Go back. Also closes the menu bar panel and leaves the skip-ahead sheet." />
        <Row label="Cmd+W" hint="Hide the window to the menu bar." />
      </Section>

      <Section title="This Mac">
        <Row label="Open Six at login" hint={loginProblem ?? (atLogin === null ? "Unavailable in this build." : "The list is in front of you when the day starts.")}>
          {atLogin !== null && <Toggle value={atLogin} onChange={(v) => void openAtLogin(v)} />}
        </Row>
        <Row label="Appearance" hint="Light unless you choose otherwise.">
          <select value={s.appearance} onChange={(e) => set("appearance", e.target.value)} className={SELECT}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Follow macOS</option>
          </select>
        </Row>
      </Section>

      <Section title="Menu bar">
        <Row label="Style" hint="Compact shows only the position, for crowded menu bars.">
          <select
            value={s.tray_style}
            onChange={(e) => set("tray_style", e.target.value)}
            className="h-7 rounded-control border border-stone-200 bg-white px-2 text-[13px] text-stone-900 focus:border-stone-400 focus:outline-none"
          >
            <option value="full">Task title</option>
            <option value="compact">Compact</option>
          </select>
        </Row>
        <Row label="Minutes left" hint="The minutes left of a pomodoro or a break, beside the position. Changes once a minute.">
          <Toggle value={s.tray_minutes} onChange={(v) => set("tray_minutes", v)} />
        </Row>
      </Section>

      <Section title="Nudges">
        <Row label="When the window is away" hint={s.nudge_style === "system" ? "macOS Notification Centre. Needs a signed build; ad-hoc builds are silently ignored by macOS." : "Six's own banner under the menu bar. Works everywhere."}>
          <select
            value={s.nudge_style}
            onChange={(e) => set("nudge_style", e.target.value)}
            className="h-7 rounded-control border border-stone-200 bg-white px-2 text-[13px] text-stone-900 focus:border-stone-400 focus:outline-none"
          >
            <option value="banner">Six's banner</option>
            <option value="system">macOS notifications</option>
          </select>
        </Row>
        {s.nudge_style === "system" && (
          <Row label="Permission" hint={notif ? (permissionWord[notif.permission] ?? notif.permission) : "…"}>
            {notif?.available && notif.permission !== "granted" && (
              <Button size="sm" className="px-3" onClick={() => void askPermission()}>
                Allow
              </Button>
            )}
          </Row>
        )}
      </Section>

      <Section title="Data">
        <Row label="Export all data" hint={exported ?? (info ? `JSON, to ${tildePath(info.exports_dir)}.` : "")}>
          <Button size="sm" className="px-3" onClick={() => void exportAll()}>
            Export
          </Button>
        </Row>
        {info && <Row label="Daily copy" hint={`A copy of the database once a day; the last 7 are kept in ${tildePath(info.backups_dir)}.`} />}
        {info && (
          <p className="mt-3 font-serif text-[12px] leading-5 text-stone-400">
            Six {info.version} · data in {tildePath(info.data_dir)}
          </p>
        )}
      </Section>
    </div>
  );
}

const SELECT = "h-7 rounded-control border border-stone-200 bg-white px-2 text-[13px] text-stone-900 focus:border-stone-400 focus:outline-none";

const SHORTCUT_NAMES: Record<GlobalShortcut, string> = {
  off: "Off",
  "alt+cmd+6": "Option+Cmd+6",
  "ctrl+alt+6": "Control+Option+6",
  "ctrl+alt+space": "Control+Option+Space",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <Label>{title}</Label>
      <div className="mt-1 divide-y divide-stone-200 border-b border-stone-200">{children}</div>
    </section>
  );
}

/** A labelled row: the control is named by the visible label, for assistive tech too. */
function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-labelledby"?: string }>, { "aria-labelledby": id })
    : children;
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div id={id} className="text-[15px] leading-6 text-stone-900">
          {label}
        </div>
        {hint && <div className="text-[12px] leading-4 text-stone-500">{hint}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}

type Named = { "aria-labelledby"?: string };

function HourSelect({ value, onChange, ...named }: { value: number; onChange: (v: number) => void } & Named) {
  return (
    <select
      {...named}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-7 rounded-control border border-stone-200 bg-white px-2 text-[13px] tabular-nums text-stone-900 focus:border-stone-400 focus:outline-none"
    >
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {hourLabel(h)}
        </option>
      ))}
    </select>
  );
}

function NumberField({ value, min, max, onChange, suffix, ...named }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string } & Named) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isInteger(n) && n >= min && n <= max && n !== value) onChange(n);
    else setDraft(String(value));
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        {...named}
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="h-7 w-14 rounded-control border border-stone-200 bg-white px-2 text-right text-[13px] tabular-nums text-stone-900 focus:border-stone-400 focus:outline-none"
      />
      {suffix && <span className="font-serif text-[12px] text-stone-500">{suffix}</span>}
    </span>
  );
}

function Toggle({ value, onChange, ...named }: { value: boolean; onChange: (v: boolean) => void } & Named) {
  return (
    <button
      {...named}
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-10 rounded-full transition-colors duration-150 ${value ? "bg-stone-900" : "bg-stone-300"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-150 ${value ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
