"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/admin/actions";

type Win = { start: number; end: number };
type Day = { weekday: number; windows: Win[] };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
const DEFAULT: Win = { start: 10 * 60, end: 19 * 60 };

/** Weekly working hours: each day on/off, with up to three time windows (e.g. a lunch break). */
export function ScheduleEditor({ initial, action }: { initial: Day[]; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [days, setDays] = useState<Day[]>(initial);
  const [state, formAction, pending] = useActionState(action, null);
  const set = (weekday: number, windows: Win[]) => setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, windows } : d)));
  const working = days.filter((d) => d.windows.length).length;

  function copyToAll(from: Day) {
    setDays((ds) => ds.map((d) => (d.windows.length || d.weekday === from.weekday ? { ...d, windows: from.windows.map((w) => ({ ...w })) } : d)));
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="schedule" value={JSON.stringify(days)} />
      <p className="text-sm text-muted">
        {working ? `You work ${working} day${working > 1 ? "s" : ""} a week.` : "You have no working days yet — customers cannot book you."} Times are IST.
      </p>
      <ul className="mt-4 space-y-3">
        {ORDER.map((wd) => {
          const d = days.find((x) => x.weekday === wd)!;
          const on = d.windows.length > 0;
          return (
            <li key={wd} className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-plum-ink">{DAY_NAMES[wd]}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Working on ${DAY_NAMES[wd]}`}
                  onClick={() => set(wd, on ? [] : [{ ...DEFAULT }])}
                  className={`relative h-8 w-14 flex-none rounded-full transition-colors ${on ? "bg-plum" : "bg-[rgb(75_29_63/0.18)]"}`}
                >
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-7" : "translate-x-1"}`} />
                </button>
              </div>
              {on ? (
                <div className="mt-3 space-y-2">
                  {d.windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <label className="sr-only" htmlFor={`s-${wd}-${i}`}>
                        {DAY_NAMES[wd]} start time
                      </label>
                      <input
                        id={`s-${wd}-${i}`}
                        type="time"
                        step={900}
                        value={toTime(w.start)}
                        onChange={(e) => set(wd, d.windows.map((x, j) => (j === i ? { ...x, start: toMin(e.target.value) } : x)))}
                        className="input min-h-11 py-2"
                      />
                      <span className="text-muted" aria-hidden>
                        to
                      </span>
                      <label className="sr-only" htmlFor={`e-${wd}-${i}`}>
                        {DAY_NAMES[wd]} end time
                      </label>
                      <input
                        id={`e-${wd}-${i}`}
                        type="time"
                        step={900}
                        value={toTime(w.end)}
                        onChange={(e) => set(wd, d.windows.map((x, j) => (j === i ? { ...x, end: e.target.value === "00:00" ? 1440 : toMin(e.target.value) } : x)))}
                        className="input min-h-11 py-2"
                      />
                      {d.windows.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm flex-none px-2" aria-label="Remove this time window" onClick={() => set(wd, d.windows.filter((_, j) => j !== i))}>
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
                    {d.windows.length < 3 && (
                      <button
                        type="button"
                        className="link tap-link"
                        onClick={() => {
                          const last = d.windows[d.windows.length - 1];
                          const start = Math.min(last.end + 60, 22 * 60);
                          set(wd, [...d.windows, { start, end: Math.min(start + 180, 1440) }]);
                        }}
                      >
                        + Add another time
                      </button>
                    )}
                    <button type="button" className="link tap-link" onClick={() => copyToAll(d)}>
                      Copy to all working days
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Day off</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t hairline bg-ivory/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save working hours"}
        </button>
        {state?.ok && (
          <p className="text-sm text-success" role="status">
            {state.ok}
          </p>
        )}
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
