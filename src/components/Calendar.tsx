"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalEvent } from "@/lib/schedule";
import { DAY_SHORT, addDays, formatDate, formatMinutes, formatTimeSlot, mondayOf, nowLocal, weekday } from "@/lib/time";
import { EventDialog } from "./EventDialog";
import { PersonalEventDialog } from "./PersonalEventDialog";

type View = "day" | "week" | "month";

/** Fired on `window` whenever the student's timetable changes (edits, assistant actions). */
export const SCHEDULE_CHANGED = "upt:schedule-changed";

const KIND_STYLE: Record<string, { block: string; dot: string; label: string }> = {
  course: { block: "border-brand-500 bg-brand-50 text-brand-900", dot: "bg-brand-500", label: "Lecture" },
  seminar: { block: "border-emerald-500 bg-emerald-50 text-emerald-900", dot: "bg-emerald-500", label: "Seminar" },
  lab: { block: "border-amber-500 bg-amber-50 text-amber-900", dot: "bg-amber-500", label: "Lab" },
  project: { block: "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-900", dot: "bg-fuchsia-500", label: "Project" },
  other: { block: "border-slate-400 bg-slate-100 text-slate-800", dot: "bg-slate-400", label: "Other" },
  exam: { block: "border-red-500 bg-red-50 text-red-900", dot: "bg-red-500", label: "Exam" },
  personal: { block: "border-violet-500 bg-violet-50 text-violet-900", dot: "bg-violet-500", label: "Personal" },
};

export function kindStyle(kind: string) {
  return KIND_STYLE[kind] ?? KIND_STYLE.other;
}

const HOUR_PX = 56;

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
  initialFrom,
  initialTo,
  initialWeek,
  today,
  hasGroup,
}: {
  initialEvents: CalEvent[];
  initialFrom: string;
  initialTo: string;
  initialWeek: number | null;
  today: string;
  hasGroup: boolean;
}) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [events, setEvents] = useState<CalEvent[]>(initialEvents);
  const [loaded, setLoaded] = useState({ from: initialFrom, to: initialTo });
  const [teachingWeek, setTeachingWeek] = useState<number | null>(initialWeek);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(() => nowLocal());
  const requestId = useRef(0);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async (from: string, to: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Your session has expired. Please sign in again." : "Could not load the calendar.");
      const data = (await res.json()) as { events: CalEvent[]; teachingWeek: number | null };
      if (id !== requestId.current) return;
      setEvents(data.events);
      setTeachingWeek(data.teachingWeek);
      setLoaded({ from, to });
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-navigation; state is set from the async result
    if (range.from !== loaded.from || range.to !== loaded.to) void load(range.from, range.to);
  }, [range, loaded, load]);

  useEffect(() => {
    const refresh = () => void load(range.from, range.to);
    window.addEventListener(SCHEDULE_CHANGED, refresh);
    return () => window.removeEventListener(SCHEDULE_CHANGED, refresh);
  }, [load, range]);

  useEffect(() => {
    // Phones get the single-day view, where a week grid would be unreadable.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time adaptation to the viewport after hydration
    if (window.matchMedia("(max-width: 640px)").matches) setView("day");
    const tick = setInterval(() => setNow(nowLocal()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const step = (dir: 1 | -1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(`${anchor.slice(0, 8)}01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  };

  const title =
    view === "day"
      ? formatDate(anchor, { weekday: "long", day: "numeric", month: "long" })
      : view === "week"
        ? `${formatDate(range.from, { day: "numeric", month: "short" })} – ${formatDate(range.to, { day: "numeric", month: "short", year: "numeric" })}`
        : formatDate(anchor, { month: "long", year: "numeric" });

  const visible = events.filter((e) => e.date >= range.from && e.date <= range.to);

  // Grid days: weekends only appear when something is scheduled on them.
  const days = useMemo(() => {
    if (view === "day") return [anchor];
    const all = Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
    return all.filter((d) => weekday(d) <= 5 || visible.some((e) => e.date === d));
  }, [view, anchor, range.from, visible]);

  const startHour = Math.min(8, ...visible.map((e) => Math.floor(e.startMin / 60)));
  const endHour = Math.max(20, ...visible.map((e) => Math.ceil(e.endMin / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  return (
    <section className="card flex min-h-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2" onClick={() => step(-1)} aria-label="Previous">‹</button>
          <button className="btn-secondary" onClick={() => setAnchor(today)}>Today</button>
          <button className="btn-ghost px-2" onClick={() => step(1)} aria-label="Next">›</button>
        </div>
        <h2 className="order-first w-full truncate text-base font-semibold text-slate-900 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
          {title}
          {view !== "month" && teachingWeek && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Week {teachingWeek}</span>}
          {loading && <span className="ml-2 text-xs font-normal text-slate-400">Loading…</span>}
        </h2>
        <div className="ml-auto flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm sm:ml-0">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 capitalize ${view === v ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              aria-pressed={view === v}
            >
              {v}
            </button>
          ))}
        </div>
        <button className="btn-secondary" onClick={() => setAdding(true)}>+ Event</button>
      </header>

      {error && <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {view === "month" ? (
        <MonthGrid
          from={range.from}
          month={anchor.slice(0, 7)}
          today={today}
          events={visible}
          onPickDay={(d) => {
            setAnchor(d);
            setView("day");
          }}
        />
      ) : (
        <div className="overflow-auto">
          <div className="grid min-w-full" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(${view === "day" ? "0" : "7.5rem"}, 1fr))` }}>
            <div className="sticky top-0 z-20 border-b border-slate-200 bg-white" />
            {days.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setAnchor(d);
                  setView("day");
                }}
                className={`sticky top-0 z-20 border-b border-l border-slate-200 bg-white px-2 py-2 text-left text-xs ${d === today ? "text-brand-700" : "text-slate-500"}`}
              >
                <span className="font-medium uppercase tracking-wide">{DAY_SHORT[weekday(d)]}</span>
                <span className={`ml-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold ${d === today ? "bg-brand-600 text-white" : "text-slate-800"}`}>
                  {+d.slice(8)}
                </span>
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
                <div key={d} className={`relative border-l border-slate-200 ${d === today ? "bg-brand-50/30" : ""}`} style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h, i) => (
                    <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * HOUR_PX }} />
                  ))}
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
                    return (
                      <button
                        key={event.id}
                        onClick={() => setSelected(event)}
                        className={`absolute overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-xs shadow-sm transition hover:z-10 hover:shadow-md ${style.block}`}
                        style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)` }}
                      >
                        <span className="block truncate font-semibold leading-tight">
                          {cols > 2 || (view === "week" && days.length > 5) ? (event.abbr ?? event.title) : event.title}
                        </span>
                        {height > 34 && (
                          <span className="block truncate opacity-80">
                            {formatTimeSlot(event.startMin, event.endMin)}
                            {event.room ? ` · ${event.room}` : ""}
                          </span>
                        )}
                        {height > 54 && <span className="block truncate opacity-70">{style.label}{event.teacher ? ` · ${event.teacher}` : ""}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {!visible.length && !loading && (
            <p className="border-t border-slate-100 px-4 py-6 text-center text-sm text-slate-500">
              {hasGroup
                ? "Nothing scheduled in this period — no classes, exams or personal events."
                : "No timetable is linked to your profile yet. Pick a group in Settings, or add your own events."}
            </p>
          )}
        </div>
      )}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
        {["course", "seminar", "lab", "project", "exam", "personal"].map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${kindStyle(k).dot}`} />
            {kindStyle(k).label}
          </span>
        ))}
      </footer>

      {selected && <EventDialog event={selected} onClose={() => setSelected(null)} />}
      {adding && <PersonalEventDialog defaultDate={view === "month" ? today : anchor} onClose={() => setAdding(false)} />}
    </section>
  );
}

function MonthGrid({
  from,
  month,
  today,
  events,
  onPickDay,
}: {
  from: string;
  month: string;
  today: string;
  events: CalEvent[];
  onPickDay: (date: string) => void;
}) {
  const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className="grid grid-cols-7 text-xs">
      {DAY_SHORT.slice(1).map((d) => (
        <div key={d} className="border-b border-slate-200 px-2 py-1.5 font-medium uppercase tracking-wide text-slate-500">{d}</div>
      ))}
      {cells.map((d) => {
        const dayEvents = events.filter((e) => e.date === d);
        const inMonth = d.startsWith(month);
        return (
          <button
            key={d}
            onClick={() => onPickDay(d)}
            className={`min-h-24 border-b border-l border-slate-100 p-1.5 text-left align-top transition hover:bg-slate-50 ${inMonth ? "" : "bg-slate-50/60 text-slate-400"}`}
          >
            <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold ${d === today ? "bg-brand-600 text-white" : ""}`}>
              {+d.slice(8)}
            </span>
            <span className="mt-1 block space-y-0.5">
              {dayEvents.slice(0, 3).map((e) => (
                <span key={e.id} className="flex items-center gap-1 truncate">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${kindStyle(e.kind).dot}`} />
                  <span className="truncate text-slate-700">{formatMinutes(e.startMin)} {e.abbr ?? e.title}</span>
                </span>
              ))}
              {dayEvents.length > 3 && <span className="block text-slate-400">+{dayEvents.length - 3} more</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
