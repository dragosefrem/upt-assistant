import { useLocale, useT } from "@/i18n/client";
import { hourViews, type AvailabilityDay, type CampusTime } from "@/lib/planning-range";
export { availabilityDays, hourViews } from "@/lib/planning-range";
import type { FreeSlot } from "@/lib/schedule";
import { dayName, daysBetween, formatDate, formatDateRange, formatMinutes, weekday } from "@/lib/time";

function shade(fraction: number): string {
  if (fraction === 0) return "bg-slate-100 text-slate-600";
  if (fraction <= 0.25) return "bg-teal-100 text-teal-950";
  if (fraction <= 0.5) return "bg-teal-200 text-teal-950";
  if (fraction <= 0.75) return "bg-teal-700 text-white";
  return "bg-teal-800 text-white";
}

const elapsedPattern = {
  backgroundImage: "repeating-linear-gradient(135deg, #f8fafc 0 3px, #cbd5e1 3px 5px)",
};
export const windowLabel = (slot: FreeSlot) => `${formatMinutes(slot.startMin)}–${formatMinutes(slot.endMin)}`;

interface ChartProps {
  days: AvailabilityDay[];
  selectedDay: AvailabilityDay;
  selectedSlot?: FreeSlot;
  asOf: CampusTime;
  hours: typeof hourViews[number];
  onSelect: (date: string, slot?: FreeSlot) => void;
}

export function AvailabilityCharts({ days, selectedDay, selectedSlot, asOf, hours, onSelect }: ChartProps) {
  const t = useT().contacts.availability;
  const locale = useLocale();
  const duration = (minutes: number) => t.duration(Math.floor(minutes / 60), minutes % 60);
  const spoken = (minutes: number) => t.durationLong(Math.floor(minutes / 60), minutes % 60);
  const longDate = (date: string) => formatDate(date, { weekday: "long", day: "numeric", month: "long" }, locale);
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const weekStart = Math.floor(daysBetween(first, selectedDay.date) / 7) * 7;
  const week = days.slice(weekStart, weekStart + 7);
  const { date: today, minutes: elapsed } = asOf;
  const span = hours.endMin - hours.startMin;
  const elapsedWidth = Math.min(span, Math.max(0, elapsed - hours.startMin)) / span * 100;
  const longest = days.flatMap((day) => day.slots).reduce<FreeSlot | undefined>((best, slot) =>
    !best || slot.endMin - slot.startMin > best.endMin - best.startMin ? slot : best, undefined);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
    <section aria-labelledby="availability-calendar" className="card flex min-w-0 flex-col p-4 sm:p-5">
      <h2 id="availability-calendar" className="text-lg font-semibold tracking-tight">{t.calendarHeading}</h2>
      <p className="mt-0.5 text-sm text-slate-600">{formatDateRange(first, last, locale)}</p>
      <div role="group" aria-label={t.daysInRange} className="my-4 grid grid-cols-7 gap-1 sm:gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => <span key={day} aria-hidden="true" className="pb-1 text-center text-xs font-medium text-slate-500">{dayName(day, locale, "short")}</span>)}
        {days.map(({ date, freeMinutes }, index) => {
          const selected = selectedDay.date === date;
          const label = t.dayFree(longDate(date), spoken(freeMinutes));
          return <button type="button" key={date} aria-label={label} title={label} aria-pressed={selected}
            onClick={() => onSelect(date)} style={index === 0 ? { gridColumnStart: weekday(date) } : undefined}
            className={`flex min-h-12 min-w-0 flex-col items-center justify-center rounded-lg px-0.5 leading-tight hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${shade(freeMinutes / span)} ${selected ? "ring-2 ring-brand-600 ring-offset-1" : ""}`}>
            <span className="text-sm font-semibold tabular-nums">{Number(date.slice(8))}{date.endsWith("-01") && <span className="ml-0.5 text-[9px]">{formatDate(date, { month: "short" }, locale)}</span>}</span>
            <span className="text-[10px] font-medium tabular-nums min-[400px]:text-xs">{duration(freeMinutes)}</span>
          </button>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-24 text-xs text-slate-600 sm:pr-0">
        <span>{t.sharedFree}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {duration(0)}
          <span className="flex gap-0.5" aria-hidden="true">{[0, 0.25, 0.5, 0.75, 1].map((part) => <span key={part} className={`h-3 w-3 rounded-sm sm:w-4 ${shade(part)}`} />)}</span>
          {duration(span)}
        </span>
      </div>
      {longest && <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-slate-200 pt-3 pr-24 text-sm sm:pr-0">
          <span className="font-medium text-slate-600">{t.longest}</span>
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onSelect(longest.date, longest)}>
            {formatDate(longest.date, { weekday: "short", day: "numeric", month: "short" }, locale)} · {windowLabel(longest)}
          </button>
        </div>
      </div>}
    </section>
    <section aria-labelledby="availability-timeline" className="card min-w-0 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 id="availability-timeline" className="text-lg font-semibold tracking-tight">{t.timelineHeading}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{formatDateRange(week[0].date, week[week.length - 1].date, locale)}</p>
        </div>
        {days.length > 7 && <div className="flex gap-1">
          <button type="button" className="btn-secondary px-2.5" aria-label={t.previousDays} disabled={!weekStart}
            onClick={() => onSelect(days[weekStart - 7].date)}>←</button>
          <button type="button" className="btn-secondary px-2.5" aria-label={t.nextDays} disabled={weekStart + 7 >= days.length}
            onClick={() => onSelect(days[weekStart + 7].date)}>→</button>
        </div>}
      </header>
      <div className="mt-4 space-y-1.5">
        <div aria-hidden="true" className="relative ml-[4.05rem] h-4 font-mono text-[10px] tabular-nums text-slate-500 sm:text-xs">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ left: `${i * 25}%` }}
            className={`absolute ${i === 4 ? "-translate-x-full" : i > 0 ? "-translate-x-1/2" : ""}`}>{formatMinutes(hours.startMin + span * i / 4)}</span>)}
        </div>
        {week.map(({ date, slots }) => <div key={date} className="grid grid-cols-[3.55rem_minmax(0,1fr)] items-center gap-2">
          <button type="button" aria-label={t.selectDay(longDate(date))} aria-pressed={selectedDay.date === date}
            onClick={() => onSelect(date)} className={`rounded-md py-1 text-left text-xs font-medium tabular-nums hover:underline sm:text-sm ${selectedDay.date === date ? "text-brand-700" : "text-slate-600"}`}>
            {dayName(weekday(date), locale, "short")} {Number(date.slice(8))}
          </button>
          <div className="relative h-6 rounded-md bg-slate-200">
            {date === today && elapsedWidth > 0 && <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-l-md" style={{ ...elapsedPattern, width: `${elapsedWidth}%` }} />}
            {slots.map((slot) => {
              const active = slot === selectedSlot;
              const label = `${longDate(date)}, ${windowLabel(slot)}`;
              return <button key={slot.startMin} type="button" title={label} aria-label={label} aria-pressed={active}
                onClick={() => onSelect(date, slot)}
                style={{ left: `${(slot.startMin - hours.startMin) / span * 100}%`, width: `${(slot.endMin - slot.startMin) / span * 100}%` }}
                className={`absolute inset-y-0 rounded-sm transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${active ? "bg-brand-600 hover:bg-brand-700" : "bg-teal-600 hover:bg-teal-700"}`} />;
            })}
            {[25, 50, 75].map((pct) => <span key={pct} aria-hidden="true" style={{ left: `${pct}%` }} className="pointer-events-none absolute inset-y-0 border-l border-white/55" />)}
          </div>
        </div>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-teal-600" />{t.freeTogether}</span>
        <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-slate-200" />{t.busy}</span>
        <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-brand-600" />{t.selected}</span>
        {elapsedWidth > 0 && week.some((day) => day.date === today) && <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={elapsedPattern} />{t.past}</span>}
      </div>
    </section>
  </div>;
}
