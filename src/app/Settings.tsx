import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement } from "react";
import { Button, Label } from "../components/ui";
import { api } from "../lib/api";
import { hourLabel } from "../lib/format";
import type { AppInfo, DaySnapshot, NotificationStatus, Settings as SettingsView } from "../lib/types";
import { useStore } from "../store";

// A minimal screen (SPEC §4.9). Every value is saved as it changes; Rust validates.

export function Settings({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const previous = useStore((s) => s.previous);
  const dispatch = useStore((s) => s.dispatch);
  const s = snapshot.settings;
  // Back returns to wherever Settings was opened from.
  const back = previous && previous.name !== "settings" ? previous : { name: "history" as const };
  const [notif, setNotif] = useState<NotificationStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    api.notificationStatus().then(setNotif).catch(() => setNotif({ available: false, permission: "unavailable" }));
    api.getAppInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

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
      setExported(`Saved to ${r.paths[0]?.replace(/^\/Users\/[^/]+/, "~") ?? r.dir}`);
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
    <div className="pb-16">
      <header className="relative flex items-center justify-center py-1">
        <button type="button" className="absolute left-0 text-sm text-stone-500 hover:text-stone-900" onClick={() => navigate(back)}>
          Back
        </button>
        <Label>Settings</Label>
      </header>
      <h1 className="mt-8 font-serif text-3xl font-normal text-stone-900">Settings</h1>

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
      </Section>

      <Section title="Menu bar">
        <Row label="Style" hint="Compact shows only the position, for crowded menu bars.">
          <select
            value={s.tray_style}
            onChange={(e) => set("tray_style", e.target.value)}
            className="rounded-control border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none"
          >
            <option value="full">Task title</option>
            <option value="compact">Compact</option>
          </select>
        </Row>
      </Section>

      <Section title="Nudges">
        <Row label="When the window is away" hint={s.nudge_style === "system" ? "macOS Notification Centre. Needs a signed build; ad-hoc builds are silently ignored by macOS." : "Six's own banner under the menu bar. Works everywhere."}>
          <select
            value={s.nudge_style}
            onChange={(e) => set("nudge_style", e.target.value)}
            className="rounded-control border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none"
          >
            <option value="banner">Six's banner</option>
            <option value="system">macOS notifications</option>
          </select>
        </Row>
        {s.nudge_style === "system" && (
          <Row label="Permission" hint={notif ? (permissionWord[notif.permission] ?? notif.permission) : "…"}>
            {notif?.available && notif.permission !== "granted" && (
              <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => void askPermission()}>
                Allow
              </Button>
            )}
          </Row>
        )}
      </Section>

      <Section title="Data">
        <Row label="Export all data" hint={exported ?? (info ? `JSON, to ${info.exports_dir.replace(/^\/Users\/[^/]+/, "~")}.` : "")}>
          <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => void exportAll()}>
            Export
          </Button>
        </Row>
        {info && (
          <p className="mt-3 text-xs text-stone-400">
            Six {info.version} · data in {info.data_dir.replace(/^\/Users\/[^/]+/, "~")}
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <Label>{title}</Label>
      <div className="mt-2 divide-y divide-stone-200 rounded-card border border-stone-200 bg-white px-4">{children}</div>
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
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div id={id} className="text-[15px] text-stone-900">
          {label}
        </div>
        {hint && <div className="text-xs text-stone-500">{hint}</div>}
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
      className="rounded-control border border-stone-200 bg-white px-2 py-1.5 text-sm tabular-nums text-stone-900 focus:border-stone-400 focus:outline-none"
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
        className="w-16 rounded-control border border-stone-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-stone-900 focus:border-stone-400 focus:outline-none"
      />
      {suffix && <span className="text-xs text-stone-400">{suffix}</span>}
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
