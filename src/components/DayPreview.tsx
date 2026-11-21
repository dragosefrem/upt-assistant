"use client";

import type { ReactNode } from "react";
import { CalendarClock, Check, ChevronDown, Volume2 } from "lucide-react";
import { useT } from "@/i18n/client";
import type { DayPreview } from "@/lib/assistant/choices";
import { kindStyle } from "@/lib/kinds";

const PX_PER_MIN = 0.6;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

function dayLabel(date: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * A proposed calendar change drawn on that day's timeline: the student's other events,
 * the new or moved event highlighted, its old place dashed, and anything it overlaps in red.
 */
export function DayPreviewCard({ preview, locale, actions, onRead }: { preview: DayPreview; locale: string; actions?: ReactNode; onRead?: () => void }) {
  const t = useT();
  const tr = t.assistant.preview;
  const start = toMin(preview.start);
  const end = toMin(preview.end);
  const ghost = preview.from && preview.from.date === preview.date ? { start: toMin(preview.from.start), end: toMin(preview.from.end) } : null;
  // Show the change with about an hour and a half around it, on whole hours.
  const lo = Math.max(0, Math.floor((Math.min(start, ghost?.start ?? start) - 90) / 60) * 60);
  const hi = Math.min(24 * 60, Math.ceil((Math.max(end, ghost?.end ?? end) + 90) / 60) * 60);
  const top = (m: number) => (Math.max(m, lo) - lo) * PX_PER_MIN;
  const height = (a: number, b: number) => Math.max((Math.min(b, hi) - Math.max(a, lo)) * PX_PER_MIN, 16);

  const visible = preview.events.filter((e) => toMin(e.end) > lo && toMin(e.start) < hi);
  const earlier = preview.events.filter((e) => toMin(e.end) <= lo).length;
  const later = preview.events.filter((e) => toMin(e.start) >= hi).length;
  const clashes = [
    ...preview.events.filter((e) => e.overlaps).map((e) => `${e.title} (${e.start}–${e.end})`),
    ...(preview.otherClashes ?? []).map((e) => `${e.title} (${dayLabel(e.date, locale, { day: "numeric", month: "short" })}, ${e.start}–${e.end})`),
  ];
  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);
  const accepted = preview.status === "accepted";

  return (
    <article aria-label={preview.title} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${accepted ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700"}`}>
          {accepted ? <Check size={17} aria-hidden /> : <CalendarClock size={17} aria-hidden />}
        </span>
        <h3 className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">{preview.title}</h3>
        <span className={`shrink-0 text-[11px] font-medium ${accepted ? "text-emerald-700" : "text-slate-600"}`}>
          {accepted ? tr.saved : tr.label}
        </span>
        {onRead && <button type="button" onClick={onRead} aria-label={t.assistant.speech.readAloud} className="grid size-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><Volume2 size={15} aria-hidden /></button>}
      </header>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
        {preview.from && <>
          <dt className="text-xs text-slate-500">{tr.original}</dt>
          <dd className="text-slate-600">{dayLabel(preview.from.date, locale, { weekday: "short", day: "numeric", month: "short" })} · {preview.from.start}–{preview.from.end}</dd>
        </>}
        <dt className="text-xs text-slate-500">{preview.from ? tr.proposed : tr.date}</dt>
        <dd className="font-semibold text-slate-900">{dayLabel(preview.date, locale, { weekday: "short", day: "numeric", month: "short" })} · {preview.start}–{preview.end}</dd>
        {preview.roomChange && <><dt className="text-xs text-slate-500">{tr.room}</dt><dd>{preview.roomChange.from && <>{preview.roomChange.from} → </>}{preview.roomChange.to}</dd></>}
        {preview.action === "move" || preview.weekly ? <><dt className="text-xs text-slate-500">{tr.appliesTo}</dt><dd className="text-xs text-slate-700">{preview.weekly ? tr.series : tr.once}</dd></> : null}
      </dl>
      <details className="group border-t border-slate-100">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium text-brand-700"><ChevronDown aria-hidden size={13} className="group-open:rotate-180" />{tr.timelineDetails}</summary>
        {earlier > 0 && <p className="px-3 pt-2 text-[11px] text-slate-400">{tr.earlier(earlier)}</p>}

        <div className="relative mx-3 my-2" style={{ height: (hi - lo) * PX_PER_MIN }} aria-label={tr.timeline(`${hours[0] / 60}:00`)}>
          {hours.map((h) => (
            <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: top(h) }}>
              <span className="absolute -top-2 left-0 bg-white pr-1 text-[10px] tabular-nums text-slate-400">{`${String(h / 60).padStart(2, "0")}:00`}</span>
            </div>
          ))}
          {visible.map((e, i) => {
            const s = toMin(e.start);
            const style = e.overlaps ? "border-red-400 bg-red-50 text-red-900" : kindStyle(e.kind).block;
            return (
              <div
                key={i}
                className={`absolute left-10 right-0 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-[11px] leading-tight ${style}`}
                style={{ top: top(s), height: height(s, toMin(e.end)) }}
                title={`${e.start}–${e.end} ${e.title}${e.room ? `, ${e.room}` : ""}`}
              >
                <span className="font-medium">{e.start}</span> {e.title}
              </div>
            );
          })}
          {ghost && (
            <div
              className="absolute left-[42%] right-0 rounded-md border-2 border-dashed border-slate-300 bg-white/70 px-1.5 py-0.5 text-[11px] leading-tight text-slate-400"
              style={{ top: top(ghost.start), height: height(ghost.start, ghost.end) }}
            >
              {tr.was(`${preview.from!.start}–${preview.from!.end}`)}
            </div>
          )}
          <div
            className={`absolute left-[42%] right-0 z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-[11px] leading-tight shadow-md ring-2 ring-white ${
              accepted ? "bg-emerald-600 text-white" : "bg-brand-600 text-white"
            }`}
            style={{ top: top(start), height: height(start, end) }}
          >
            <span className="block font-semibold">{preview.title}</span>
            <span className="opacity-90">
              {preview.start}–{preview.end} · {preview.action === "add" ? tr.isNew : tr.moved}
            </span>
          </div>
        </div>

        {later > 0 && <p className="px-3 pb-1 text-[11px] text-slate-400">{tr.later(later)}</p>}
      </details>
      {clashes.length > 0 && (
        <p className="mx-3 mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">
          {tr.overlaps(clashes.join(", "))}
        </p>
      )}
      {actions && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">{actions}</div>}
    </article>
  );
}
