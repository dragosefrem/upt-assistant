"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalEvent } from "@/lib/schedule";
import { addDays, formatDate, formatMinutes, formatTimeSlot, nowLocal } from "@/lib/time";
import { SCHEDULE_CHANGED, kindStyle } from "./Calendar";
import { TripSuggestions } from "./TripSuggestions";

function inWords(minutes: number): string {
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}

/** "What day is it and what's next": today's date, the class in progress and the next one. */
export function NextUp({ initial }: { initial: CalEvent[] }) {
  const [events, setEvents] = useState(initial);
  const [now, setNow] = useState(() => nowLocal());

  const reload = useCallback(async () => {
    const today = nowLocal().date;
    try {
      const res = await fetch(`/api/events?from=${today}&to=${addDays(today, 14)}`, { cache: "no-store" });
      if (res.ok) setEvents((await res.json()).events);
    } catch {
      // Keep showing what we have; the next tick retries.
    }
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(nowLocal()), 30_000);
    const refresh = setInterval(reload, 10 * 60_000);
    window.addEventListener(SCHEDULE_CHANGED, reload);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      window.removeEventListener(SCHEDULE_CHANGED, reload);
    };
  }, [reload]);

  const current = events.find((e) => e.date === now.date && e.startMin <= now.minutes && e.endMin > now.minutes);
  const next = events.find((e) => e.date > now.date || (e.date === now.date && e.startMin > now.minutes));
  const leftToday = events.filter((e) => e.date === now.date && e.endMin > now.minutes).length;

  const row = (label: string, e: CalEvent, when: string) => (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${kindStyle(e.kind).dot}`} />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label} · {when}</p>
        <p className="truncate font-semibold text-slate-900">{e.title}</p>
        <p className="text-sm text-slate-600">
          {formatTimeSlot(e.startMin, e.endMin)} · {kindStyle(e.kind).label}
          {e.room ? ` · ${e.room}` : ""}
          {e.place ? ` · ${e.place.name}` : ""}
        </p>
      </div>
    </div>
  );

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{formatDate(now.date, { weekday: "long", day: "numeric", month: "long" })}</h2>
        <span className="text-sm tabular-nums text-slate-500">
          {formatMinutes(now.minutes)} · {leftToday ? `${leftToday} left today` : "nothing left today"}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {current && row("Now", current, `until ${formatMinutes(current.endMin)}`)}
        {next ? (
          <div className="space-y-1.5">
            {row("Next", next, next.date === now.date ? inWords(next.startMin - now.minutes) : formatDate(next.date, { weekday: "long", day: "numeric", month: "short" }))}
            {next.place && next.date === now.date && (
              <div className="pl-[1.375rem]"><TripSuggestions room={next.room} startMin={next.startMin} compact /></div>
            )}
          </div>
        ) : (
          !current && <p className="text-sm text-slate-600">Nothing coming up in the next two weeks.</p>
        )}
      </div>
    </section>
  );
}
