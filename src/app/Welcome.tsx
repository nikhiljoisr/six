import { useState } from "react";
import { Button, Label, Numeral } from "../components/ui";
import { api } from "../lib/api";
import type { DaySnapshot } from "../lib/types";
import { useStore } from "../store";

// Two screens, shown once. The method in a breath, then the timer and the nudges, then
// straight into the planner. Nothing here that the app does not do.

export function Welcome({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  const [step, setStep] = useState(0);
  const [notif, setNotif] = useState<string | null>(null);

  const begin = async () => {
    const err = await dispatch(() => api.setSetting("onboarded", "1"));
    if (err) return;
    navigate({ name: "planner", date: snapshot.today_plan?.locked_at ? snapshot.tomorrow : snapshot.today });
  };

  const allow = async () => {
    try {
      const s = await api.requestNotificationPermission();
      setNotif(s.permission === "granted" ? "Allowed." : s.available ? "You can change this later in Settings." : "Available in the packaged app.");
    } catch {
      setNotif("You can change this later in Settings.");
    }
  };

  return (
    <div className="flex min-h-screen flex-col pb-10 pt-6">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1].map((i) => (
          <span key={i} className={`h-1 w-4 rounded-full ${i <= step ? "bg-stone-900" : "bg-stone-200"}`} />
        ))}
      </div>

      {step === 0 ? (
        <section className="mt-14">
          <Label>How Six works</Label>
          <h1 className="mt-3 font-serif text-4xl font-normal text-stone-900">Six tasks a day.</h1>
          <ol className="mt-8 space-y-6">
            <Step n={1} title="Each evening, write tomorrow's six." body="The most important task at the top. Six is the ceiling; if something urgent comes up, swap it in." />
            <Step n={2} title="In the morning, start at the top." body="One task is active at a time. Finish it, then the next one takes over. Skipping ahead is allowed, but Six will ask you twice." />
            <Step n={3} title="At the end of the day, review." body="Three quick screens: what happened, what carries to tomorrow, and tomorrow's six." />
          </ol>
        </section>
      ) : (
        <section className="mt-14">
          <Label>Focus and nudges</Label>
          <h1 className="mt-3 font-serif text-4xl font-normal text-stone-900">Quiet by design.</h1>
          <ol className="mt-8 space-y-6">
            <Step n={1} title="Pomodoros, if you want them." body="Start a 25-minute pomodoro on the task you're on. When it rings, take five, or keep going. Interruptions are just recorded, never judged." />
            <Step n={2} title="Nudges are silent banners." body="A check-in after 75 minutes, a reminder to plan tomorrow in the evening. No sounds unless you switch them on in Settings." />
            <Step n={3} title="Six lives in the menu bar." body="Close the window and the active task stays up there. Cmd+W hides, Cmd+Q quits." />
          </ol>
          <div className="mt-8 flex items-center gap-4">
            <Button variant="secondary" className="px-4 py-2 text-sm" onClick={() => void allow()}>
              Allow notifications
            </Button>
            {notif && <span className="text-xs text-stone-500">{notif}</span>}
          </div>
        </section>
      )}

      <div className="mt-auto pt-10">
        {step === 0 ? (
          <Button full onClick={() => setStep(1)}>
            Next
          </Button>
        ) : (
          <Button full onClick={() => void begin()}>
            Plan the first six
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <Numeral n={n} size="lg" className="mt-0.5 w-5 text-center" />
      <div>
        <div className="text-[15px] font-medium text-stone-900">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-stone-500">{body}</div>
      </div>
    </li>
  );
}
