import { useState } from "react";
import { Button, Label, Numeral, Rule } from "../components/ui";
import { api } from "../lib/api";
import type { DaySnapshot } from "../lib/types";
import { useStore } from "../store";

// Two screens, shown once. The method in a breath, then the timer and the nudges, then
// straight into the planner. Nothing here that the app does not do.

export function Welcome({ snapshot }: { snapshot: DaySnapshot }) {
  const navigate = useStore((s) => s.navigate);
  const dispatch = useStore((s) => s.dispatch);
  const [step, setStep] = useState(0);

  const begin = async () => {
    const err = await dispatch(() => api.setSetting("onboarded", "1"));
    if (err) return;
    navigate({ name: "planner", date: snapshot.today_plan?.locked_at ? snapshot.tomorrow : snapshot.today });
  };

  return (
    <div className="flex min-h-screen flex-col pb-10 pt-12">
      <header className="flex h-5 items-baseline justify-between gap-6 leading-5">
        <span className="font-serif text-[15px] text-stone-900">Six</span>
        <span className="font-serif text-[12px] tabular-nums text-stone-400" aria-label={`Screen ${step + 1} of 2`}>
          {step + 1} of 2
        </span>
      </header>
      <Rule className="mt-3" />

      {step === 0 ? (
        <section className="mt-8">
          <Label>How Six works</Label>
          <h1 className="mt-2 font-serif text-[24px] leading-8 font-normal text-stone-900">Six tasks a day.</h1>
          <ol className="mt-6 space-y-5">
            <Step n={1} title="Each evening, write tomorrow's six." body="The most important task at the top. Six is the ceiling; if something urgent comes up, swap it in." />
            <Step n={2} title="In the morning, start at the top." body="One task is active at a time, and it records time from the moment the list is locked. Finish it, then the next one takes over. Skipping ahead is allowed, but Six will ask you twice." />
            <Step n={3} title="At the end of the day, review." body="Three quick screens: what happened, what carries to tomorrow, and tomorrow's six." />
          </ol>
        </section>
      ) : (
        <section className="mt-8">
          <Label>Focus and nudges</Label>
          <h1 className="mt-2 font-serif text-[24px] leading-8 font-normal text-stone-900">Quiet by design.</h1>
          <ol className="mt-6 space-y-5">
            <Step n={1} title="Pomodoros, if you want them." body="A second clock: a 25-minute countdown on the task you're on. When it rings, task time keeps recording until you take a break, start another, or continue without a timer." />
            <Step n={2} title="Nudges are quiet banners." body="A check-in after 75 minutes, a reminder to plan tomorrow in the evening. They appear in the window, or under the menu bar when it is closed. No sounds unless you switch them on." />
            <Step n={3} title="Six lives in the menu bar." body="Close the window and the active task stays up there. Cmd+W hides, Cmd+Q quits." />
          </ol>
        </section>
      )}

      <div className="mt-auto pt-8">
        <Rule className="mb-5" />
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
      <Numeral n={n} size="md" className="mt-0.5 w-5 text-center" />
      <div>
        <div className="text-[15px] leading-6 text-stone-900">{title}</div>
        <div className="mt-0.5 text-[13px] leading-5 text-stone-500">{body}</div>
      </div>
    </li>
  );
}
