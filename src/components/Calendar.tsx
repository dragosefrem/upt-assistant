"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { PublicHoliday } from "@/lib/holidays";
import type { CalEvent } from "@/lib/schedule";
import type { SponsoredOffer } from "@/lib/sponsored-events";
import { addDays, capitalize, dayName, formatDate, formatMinutes, formatTimeSlot, mondayOf, nowLocal, weekday } from "@/lib/time";
import { kindLabel, kindStyle } from "@/lib/kinds";
import { EventDialog } from "./EventDialog";
import { PersonalEventDialog } from "./PersonalEventDialog";
import { SponsoredSuggestions } from "./SponsoredSuggestions";

export { kindStyle };

type View = "day" | "week" | "month";

/** Fired on `window` whenever the student's timetable changes (edits, assistant actions). */
export const SCHEDULE_CHANGED = "upt:schedule-changed";

const HOUR_PX = 56;
/** Clicking or dragging on the grid snaps to half hours. */
const SNAP_MIN = 30;

type NewEvent = { date: string; startMin?: number; endMin?: number };
type Drag = { date: string; anchorMin: number; startMin: number; endMin: number; pointer: string; x: number; y: number; moved: boolean };

/** Small ✓ / ✗ badge for occurrences the student has marked. */
function AttendanceMark({ status, small = false, className = "" }: { status: CalEvent["attendance"]; small?: boolean; className?: string }) {
  const t = useT().calendar.attendance;
  if (!status) return null;
  const attended = status === "attended";
  return (
    <span
      title={attended ? t.attended : t.missed}
      aria-label={attended ? t.attended : t.missed}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${small ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]"} leading-none text-white ${attended ? "bg-emerald-600" : "bg-red-600"} ${className}`}
    >
      {attended ? "✓" : "✗"}
    </span>
  );
}

function rangeFor(view: View, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const first = `${anchor.slice(0, 8)}01`;
  const from = mondayOf(first);
  return { from, to: addDays(from, 41) };
}

/** Places overlapping events side by side: returns each event's column and column count. */
function layoutDay(events: CalEvent[]) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed: Array<{ event: CalEvent; col: number; cols: number }> = [];
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    cluster.forEach((p) => (p.cols = cols));
    placed.push(...cluster);
    cluster = [];
  };
  for (const event of sorted) {
    if (cluster.length && event.startMin >= clusterEnd) flush();
    const used = new Set(cluster.filter((p) => p.event.endMin > event.startMin).map((p) => p.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ event, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, event.endMin);
  }
  if (cluster.length) flush();
  return placed;
}

export function Calendar({
  initialEvents,
  initialOffers = [],
  initialHolidays,
  initialFrom,
  initialTo,
  initialWeek,
  today,
  hasGroup,
  programme,
  year,
}: {
  initialEvents: CalEvent[];
  initialOffers?: SponsoredOffer[];
  initialHolidays: PublicHoliday[];
  initialFrom: string;
  initialTo: string;
  initialWeek: number | null;
  today: string;
  hasGroup: boolean;
  programme?: { name: string; facultyUrl: string | null } | null;
  year?: number | null;
}) {
  const messages = useT();
  const t = messages.calendar;
  const locale = useLocale();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [events, setEvents] = useState<CalEvent[]>(initialEvents);
  const [offers, setOffers] = useState(initialOffers);
  const [holidays, setHolidays] = useState(initialHolidays);
  const holidayNames = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  // Event notes come in the interface language, so a language switch also reloads.
  const [loaded, setLoaded] = useState({ from: initialFrom, to: initialTo, locale });
  const [teachingWeek, setTeachingWeek] = useState<number | null>(initialWeek);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [adding, setAdding] = useState<NewEvent | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hiddenClass, setHiddenClass] = useState<string | null>(null);
  const [now, setNow] = useState(() => nowLocal());
  const requestId = useRef(0);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async (from: string, to: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events?from=${from}&to=${to}&offers=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? t.grid.sessionExpired : t.grid.loadFailed);
      const data = (await res.json()) as { events: CalEvent[]; offers: SponsoredOffer[]; holidays: PublicHoliday[]; teachingWeek: number | null };
      if (id !== requestId.current) return;
      setEvents(data.events);
      setOffers(data.offers);
      setHolidays(data.holidays);
      setTeachingWeek(data.teachingWeek);
      setLoaded({ from, to, locale });
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [t, locale]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-navigation; state is set from the async result
    if (range.from !== loaded.from || range.to !== loaded.to || loaded.locale !== locale) void load(range.from, range.to);
  }, [range, loaded, load, locale]);

  useEffect(() => {
    const refresh = () => void load(range.from, range.to);
    const scheduleChanged = () => { setOffers([]); refresh(); };
    const refreshVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = setInterval(refreshVisible, 60_000);
    window.addEventListener(SCHEDULE_CHANGED, scheduleChanged);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SCHEDULE_CHANGED, scheduleChanged);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [load, range]);

  useEffect(() => {
    const tick = setInterval(() => setNow(nowLocal()), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const step = (dir: 1 | -1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(`${anchor.slice(0, 8)}01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  };

  const pickDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };

  const goToday = () => {
    if (view === "week" && window.matchMedia("(max-width: 47.99rem)").matches) pickDay(now.date);
    else setAnchor(now.date);
  };

  const title = capitalize(
    view === "day"
      ? formatDate(anchor, { weekday: "long", day: "numeric", month: "long" }, locale)
      : view === "week"
        ? `${formatDate(range.from, { day: "numeric", month: "short" }, locale)} – ${formatDate(range.to, { day: "numeric", month: "short", year: "numeric" }, locale)}`
        : formatDate(anchor, { month: "long", year: "numeric" }, locale),
  );

  const visible = events.filter((e) => e.date >= range.from && e.date <= range.to);

  // Grid days: the whole week, so students can plan weekends too.
  const days = useMemo(() => (view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i))), [view, anchor, range.from]);

  const startHour = Math.min(8, ...visible.map((e) => Math.floor(e.startMin / 60)));
  const endHour = Math.max(20, ...visible.map((e) => Math.ceil(e.endMin / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  /** Minute of the day under the pointer, rounded down to the snap grid. */
  const minuteAt = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = startHour * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.floor(raw / SNAP_MIN) * SNAP_MIN;
    return Math.min(Math.max(snapped, startHour * 60), endHour * 60 - SNAP_MIN);
  };

  const beginDrag = (date: string, e: React.PointerEvent<HTMLDivElement>) => {
    // Clicks on an existing class open that class instead.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const min = minuteAt(e);
    // A mouse or pen can drag out a range; on touch the finger scrolls, so a tap picks one slot.
    if (e.pointerType !== "touch") e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ date, anchorMin: min, startMin: min, endMin: min + SNAP_MIN, pointer: e.pointerType, x: e.clientX, y: e.clientY, moved: false });
  };

  const moveDrag = (date: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.date !== date) return;
    const moved = drag.moved || Math.abs(e.clientY - drag.y) > 6 || Math.abs(e.clientX - drag.x) > 6;
    if (drag.pointer === "touch") {
      // The finger is scrolling the calendar, not picking a time.
      if (moved) setDrag(null);
      return;
    }
    const min = minuteAt(e);
    setDrag({
      ...drag,
      moved,
      startMin: Math.min(drag.anchorMin, min),
      endMin: Math.max(drag.anchorMin, min) + SNAP_MIN,
    });
  };

  const endDrag = () => {
    if (!drag) return;
    // A plain click books an hour; a drag books exactly what was dragged.
    const endMin = drag.moved ? drag.endMin : Math.min(drag.startMin + 60, 24 * 60);
    setAdding({ date: drag.date, startMin: drag.startMin, endMin });
    setDrag(null);
  };

  return (
    <section className="card timetable flex min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="calendar-toolbar">
        <h2 className="calendar-range">
          {title}
          {view !== "month" && teachingWeek != null && <span className="week-label">{messages.common.time.week(teachingWeek)}</span>}
        </h2>
        <div className="calendar-dates">
          <button type="button" className="btn-ghost px-2" onClick={() => step(-1)} aria-label={t.toolbar.previous}><ChevronLeft size={17} aria-hidden /></button>
          <button type="button" className="btn-ghost px-2.5" onClick={goToday}>{messages.common.time.today}</button>
          <button type="button" className="btn-ghost px-2" onClick={() => step(1)} aria-label={t.toolbar.next}><ChevronRight size={17} aria-hidden /></button>
        </div>
        <div role="group" aria-label={t.toolbar.viewLabel} className="segments calendar-views">
          {(["day", "week", "month"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}>{t.toolbar.views[v]}</button>
          ))}
        </div>
        <button type="button" className="btn-primary calendar-add" onClick={() => setAdding({ date: view === "month" && today.startsWith(anchor.slice(0, 7)) ? today : anchor })}>
          <Plus size={16} aria-hidden />{t.grid.addEvent}
        </button>
      </header>
      {loading && <p role="status" className="px-4 pt-2 text-xs text-slate-600">{messages.common.status.loading}</p>}

      {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {hiddenClass && (
        <div className="flex items-center gap-3 border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-slate-800">
          <p role="status" className="min-w-0 flex-1">
            {t.grid.hidden(hiddenClass)}{" "}
            <Link className="font-medium text-brand-700 underline" href="/settings#hidden-classes">{t.grid.manageHidden}</Link>
          </p>
          <button type="button" className="btn-ghost px-2" aria-label={messages.common.actions.close} onClick={() => setHiddenClass(null)}>✕</button>
        </div>
      )}

      <SponsoredSuggestions
        offers={!error && loaded.from === range.from && loaded.to === range.to && loaded.locale === locale ? offers : []}
        homeWeek={view === "week" && range.from === mondayOf(now.date)}
        onChange={() => window.dispatchEvent(new Event(SCHEDULE_CHANGED))}
        onPickDay={pickDay}
      />

      {!hasGroup ? (
        <aside className="space-y-2 border-b border-slate-200 bg-brand-50/50 px-4 py-3 text-sm">
          <p>{programme && year ? t.grid.unpublished(programme.name, year) : t.grid.emptyNoGroup}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium text-brand-700">
            {programme?.facultyUrl && <a href={programme.facultyUrl} target="_blank" rel="noreferrer" className="underline">{t.grid.facultyTimetable}</a>}
            <Link href="/settings#profile" className="underline">{messages.onboarding.courses.changeGroup}</Link>
          </div>
        </aside>
      ) : view !== "month" && !visible.length && !loading && !error && loaded.from === range.from && loaded.to === range.to && (
        <p className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">{t.grid.emptyWithGroup}</p>
      )}

      {view === "month" ? (
        <MonthGrid
          from={range.from}
          month={anchor.slice(0, 7)}
          today={today}
          events={visible}
          holidayNames={holidayNames}
          t={t}
          locale={locale}
          onPickDay={pickDay}
          onAddOnDay={(d) => setAdding({ date: d })}
        />
      ) : (
        <>
          {view === "week" && (
            <WeekAgenda days={days} today={today} events={visible} holidayNames={holidayNames} onPickDay={pickDay} onSelect={setSelected} />
          )}
          <div className={view === "week" ? "hidden overflow-auto md:block" : "overflow-auto"}>
          <div className="grid min-w-full" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(${view === "day" ? "0" : "5.6rem"}, 1fr))` }}>
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white" />
            {days.map((d) => (
              <button
                key={d}
                onClick={() => pickDay(d)}
                className={`sticky top-0 z-20 border-b border-l border-slate-200 bg-white px-2 py-2 text-left text-xs ${d === today ? "text-brand-700" : "text-slate-500"}`}
              >
                <span className="font-medium uppercase tracking-wide">{dayName(weekday(d), locale, "short")}</span>
                <span className={`ml-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold ${d === today ? "bg-brand-600 text-white" : "text-slate-800"}`}>
                  {+d.slice(8)}
                </span>
                {holidayNames.has(d) && <span className="mt-1 block font-medium text-amber-800">{holidayNames.get(d)}</span>}
              </button>
            ))}

            <div className="relative" style={{ height: hours.length * HOUR_PX }}>
              {hours.map((h, i) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-slate-400" style={{ top: i * HOUR_PX }}>
                  {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const dayEvents = visible.filter((e) => e.date === d);
              const showNow = d === now.date && now.minutes >= startHour * 60 && now.minutes <= endHour * 60;
              return (
                <div
                  key={d}
                  className={`group/day relative cursor-cell select-none border-l border-slate-200 ${d === today ? "bg-brand-50/30" : ""}`}
                  style={{ height: hours.length * HOUR_PX }}
                  onPointerDown={(e) => beginDrag(d, e)}
                  onPointerMove={(e) => moveDrag(d, e)}
                  onPointerUp={endDrag}
                  onPointerCancel={() => setDrag(null)}
                  title={t.grid.clickToAdd}
                >
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * HOUR_PX }} />
                  ))}
                  {drag && drag.date === d && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-lg border-2 border-dashed border-violet-500 bg-violet-100/80 px-2 py-1 text-xs font-semibold text-violet-900"
                      style={{
                        top: ((drag.startMin - startHour * 60) / 60) * HOUR_PX,
                        height: ((drag.endMin - drag.startMin) / 60) * HOUR_PX - 2,
                      }}
                    >
                      ＋ {formatMinutes(drag.startMin)}–{formatMinutes(drag.endMin)}
                    </div>
                  )}
                  {showNow && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((now.minutes - startHour * 60) / 60) * HOUR_PX }}>
                      <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                      <span className="h-px flex-1 bg-red-500" />
                    </div>
                  )}
                  {layoutDay(dayEvents).map(({ event, col, cols }) => {
                    const style = kindStyle(event.kind);
                    const top = ((event.startMin - startHour * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((event.endMin - event.startMin) / 60) * HOUR_PX - 2);
                    const compact = height < 64 || (cols > 1 && view === "week");
                    const time = formatTimeSlot(event.startMin, event.endMin);
                    const label = [event.title, time, event.room, kindLabel(event.kind, locale), event.attendance && t.attendance[event.attendance]].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={event.id}
                        aria-label={label}
                        title={label}
                        onClick={() => setSelected(event)}
                        className={`absolute flex flex-col items-stretch justify-start overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-xs shadow-sm transition hover:z-10 hover:shadow-md ${style.block}`}
                        style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                      >
                        <AttendanceMark status={event.attendance} className="absolute right-1 top-1" />
                        <span className={`font-semibold leading-tight ${compact ? "truncate" : "line-clamp-2"} ${event.attendance ? "pr-4" : ""}`}>
                          {compact ? (event.abbr ?? event.title) : event.title}
                        </span>
                        {height > 32 && <span className="truncate tabular-nums">{time}</span>}
                        {height > 46 && event.room && <span className="truncate font-medium">{event.room}</span>}
                        {height > 84 && <span className="mt-0.5 truncate opacity-75">{kindLabel(event.kind, locale)}{event.teacher ? ` · ${event.teacher}` : ""}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          </div>
        </>
      )}

      {visible.length > 0 && <footer aria-label={t.grid.legend} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        {Array.from(new Set(visible.map((event) => event.kind))).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${kindStyle(k).dot}`} />
            {kindLabel(k, locale)}
          </span>
        ))}
      </footer>}

      {selected && <EventDialog event={selected} onHidden={setHiddenClass} onClose={() => setSelected(null)} />}
      {adding && (
        <PersonalEventDialog
          defaultDate={adding.date}
          defaultStartMin={adding.startMin}
          defaultEndMin={adding.endMin}
          onClose={() => setAdding(null)}
          onSaved={(title) => setToast(t.grid.added(title))}
        />
      )}
      {toast && (
        <p role="status" className="animate-pop fixed bottom-20 lg:bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </p>
      )}
    </section>
  );
}

function WeekAgenda({ days, today, events, holidayNames, onPickDay, onSelect }: {
  days: string[];
  today: string;
  events: CalEvent[];
  holidayNames: Map<string, string>;
  onPickDay: (date: string) => void;
  onSelect: (event: CalEvent) => void;
}) {
  const messages = useT();
  const locale = useLocale();
  if (!events.length && !days.some((day) => holidayNames.has(day))) return null;

  return (
    <div className="week-agenda divide-y divide-slate-100 md:hidden">
      {days.map((date) => {
        const dayEvents = events.filter((event) => event.date === date);
        return (
          <section key={date} className="px-4 py-2.5">
            <button type="button" className="flex w-full items-center gap-2 py-1.5 text-left text-sm font-semibold text-brand-900" onClick={() => onPickDay(date)}>
              {capitalize(formatDate(date, { weekday: "long", day: "numeric", month: "short" }, locale))}
              {date === today && <span className="week-label">{messages.common.time.today}</span>}
              <ChevronRight size={15} className="ml-auto shrink-0" aria-hidden />
            </button>
            {holidayNames.has(date) && <p className="my-1 text-xs font-medium text-amber-800">{holidayNames.get(date)}</p>}
            {dayEvents.length ? (
              <ul className="agenda-enter">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <button type="button" onClick={() => onSelect(event)} className="agenda-event">
                      <span className="flex flex-col font-mono text-xs tabular-nums">
                        <span>{formatMinutes(event.startMin)}</span>
                        {event.endMin !== event.startMin && <span className="text-slate-500"><span className="sr-only">– </span>{formatMinutes(event.endMin)}</span>}
                      </span>
                      <span className={`h-7 w-1 shrink-0 rounded-full ${kindStyle(event.kind).dot}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm">{event.title}</strong>
                        <span className="text-xs text-slate-600">{kindLabel(event.kind, locale)}{event.room ? ` · ${event.room}` : ""}</span>
                      </span>
                      <AttendanceMark status={event.attendance} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-600">{messages.calendar.grid.freeDay}</p>}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  from,
  month,
  today,
  events,
  holidayNames,
  onPickDay,
  onAddOnDay,
  t,
  locale,
}: {
  from: string;
  month: string;
  today: string;
  events: CalEvent[];
  holidayNames: Map<string, string>;
  t: Messages["calendar"];
  locale: Locale;
  onPickDay: (date: string) => void;
  onAddOnDay: (date: string) => void;
}) {
  const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className="grid grid-cols-7 text-xs">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
        <div key={d} className="truncate border-b border-slate-200 px-2 py-1.5 font-medium uppercase tracking-wide text-slate-500">{dayName(d, locale, "short")}</div>
      ))}
      {cells.map((d) => {
        const dayEvents = events.filter((e) => e.date === d);
        const inMonth = d.startsWith(month);
        const holiday = holidayNames.get(d);
        return (
          <div key={d} className={`group/cell relative min-w-0 min-h-16 sm:min-h-24 border-b border-l border-slate-100 transition hover:bg-slate-50 ${inMonth ? "" : "bg-slate-50/60 text-slate-400"}`}>
          <button
            type="button"
            onClick={() => onAddOnDay(d)}
            className="absolute right-0 top-0 z-10 hidden sm:flex h-8 w-1/2 max-w-8 items-center justify-center text-sm font-bold text-white opacity-0 transition group-hover/cell:opacity-100 focus-visible:opacity-100"
            aria-label={t.grid.addOn(formatDate(d, { weekday: "long", day: "numeric", month: "long" }, locale))}
            title={t.grid.addEvent}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 shadow-sm sm:h-6 sm:w-6">+</span>
          </button>
          <button
            aria-label={formatDate(d, { weekday: "long", day: "numeric", month: "long" }, locale)}
            onClick={() => onPickDay(d)}
            className="flex h-full min-h-16 sm:min-h-24 w-full min-w-0 flex-col justify-start px-0.5 py-1.5 text-left sm:p-1.5"
          >
            <span className={`inline-flex h-5 min-w-5 self-start items-center justify-center rounded-full px-0.5 text-xs font-semibold sm:h-6 sm:min-w-6 sm:px-1 sm:text-sm ${d === today ? "bg-brand-600 text-white" : ""}`}>
              {+d.slice(8)}
            </span>
            {holiday && <span title={holiday} className="mt-1 flex max-w-full items-center gap-1 rounded bg-amber-50 px-1 py-0.5 text-amber-900">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
              <span className="truncate">{holiday}</span>
            </span>}
            <span className="mt-1 block w-full min-w-0 space-y-0.5">
              {dayEvents.slice(0, 3).map((e) => (
                <span key={e.id} className="flex items-center gap-1 truncate">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${kindStyle(e.kind).dot}`} />
                  <span className="truncate text-slate-700">{formatMinutes(e.startMin)} {e.abbr ?? e.title}</span>
                  <AttendanceMark status={e.attendance} small className="ml-auto" />
                </span>
              ))}
              {dayEvents.length > 3 && <span className="block text-slate-400">{t.grid.more(dayEvents.length - 3)}</span>}
            </span>
          </button>
          </div>
        );
      })}
    </div>
  );
}
