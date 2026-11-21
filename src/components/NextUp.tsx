"use client";

import { Navigation, Sun } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { kindLabel } from "@/lib/kinds";
import type { CalEvent } from "@/lib/schedule";
import { addDays, capitalize, formatDate, formatMinutes, formatTimeSlot, nowLocal } from "@/lib/time";
import { SCHEDULE_CHANGED, kindStyle } from "./Calendar";
import { TripSuggestions } from "./TripSuggestions";

/** "What day is it and what's next": today's date, the class in progress and the next one. */
export function NextUp({ initial }: { initial: CalEvent[] }) {
  const messages = useT();
  const t = messages.calendar.nextUp;
  const locale = useLocale();
  const [events, setEvents] = useState(initial);
  const [now, setNow] = useState(() => nowLocal());
  const loadedLocale = useRef(locale);

  const inWords = (minutes: number) =>
    minutes < 1 ? t.startsNow : minutes < 60 ? t.inMinutes(minutes) : t.inHours(Math.floor(minutes / 60), minutes % 60);

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

  // Event notes are written in the interface language: fetch again after a language switch.
  useEffect(() => {
    if (loadedLocale.current === locale) return;
    loadedLocale.current = locale;
    void reload();
  }, [locale, reload]);

  const current = events.find((e) => e.date === now.date && e.startMin <= now.minutes && e.endMin > now.minutes);
  const next = events.find((e) => e.date > now.date || (e.date === now.date && e.startMin > now.minutes));
  const leftToday = events.filter((e) => e.date === now.date && e.endMin > now.minutes).length;

  const row = (label: string, e: CalEvent, when: string) => {
    const destination = e.campusRoom ?? (e.place ? e.room : null);
    return (
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${kindStyle(e.kind).dot}`} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label} · {when}</p>
          <p className="break-words font-semibold text-slate-900">{e.groupEventId
            ? <Link href={`/contacts/events/${e.groupEventId}`} className="text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-current">{e.title}</Link>
            : e.title}</p>
          <p className="text-sm text-slate-600">
            {formatTimeSlot(e.startMin, e.endMin)} · {kindLabel(e.kind, locale)}
            {e.room ? ` · ${e.room}` : (e.type === "class" || e.type === "exam") && ` · ${messages.exams.card.roomUnknown}`}
            {e.place && ` · ${e.place.approximate ? messages.campus.rooms.approximate(e.place.name) : e.place.name}`}
          </p>
          {destination && (
            <Link
              href={campusJourneyHref({ to: destination, building: e.place?.name, course: e.title, at: formatMinutes(e.startMin), date: e.date })}
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
            >
              <Navigation size={14} aria-hidden />
              {messages.guide.buildings.walkthrough}
            </Link>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="card next-up overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 bg-brand-50/65 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold tracking-tight text-brand-900">
          <Sun size={18} aria-hidden />{capitalize(formatDate(now.date, { weekday: "long", day: "numeric", month: "long" }, locale))}
        </h2>
        <span className="text-xs text-slate-600">{leftToday ? t.leftToday(leftToday) : t.nothingLeft}</span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] xl:grid-cols-1">
        {current && row(t.now, current, t.until(formatMinutes(current.endMin)))}
        {next ? (
          <div className="space-y-1.5">
            {row(t.next, next, next.date === now.date ? inWords(next.startMin - now.minutes) : formatDate(next.date, { weekday: "long", day: "numeric", month: "short" }, locale))}
            {next.place && next.date === now.date && (
              <div className="pl-[1.375rem]"><TripSuggestions room={next.room} startMin={next.startMin} compact /></div>
            )}
          </div>
        ) : (
          !current && <p className="text-sm text-slate-600">{t.nothingSoon}</p>
        )}
      </div>
    </section>
  );
}
