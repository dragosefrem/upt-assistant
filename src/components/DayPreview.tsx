"use client";

import type { ReactNode } from "react";
import type { DayPreview } from "@/lib/assistant/choices";
import { kindStyle } from "./Calendar";

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
export function DayPreviewCard({ preview, locale, actions }: { preview: DayPreview; locale: string; actions?: ReactNode }) {
  const start = toMin(preview.start);
  const end = toMin(preview.end);
  const ghost = preview.from && preview.from.date === preview.date ? { start: toMin(preview.from.start), end: toMin(preview.from.end) } : null;
  // Show the change with about an hour and a half around it, on whole hours.
  const lo = Math.max(6 * 60, Math.floor((Math.min(start, ghost?.start ?? start) - 90) / 60) * 60);
  const hi = Math.min(24 * 60, Math.ceil((Math.max(end, ghost?.end ?? end) + 90) / 60) * 60);
  const top = (m: number) => (Math.max(m, lo) - lo) * PX_PER_MIN;
  const height = (a: number, b: number) => Math.max((Math.min(b, hi) - Math.max(a, lo)) * PX_PER_MIN, 16);

  const visible = preview.events.filter((e) => toMin(e.end) > lo && toMin(e.start) < hi);
  const earlier = preview.events.filter((e) => toMin(e.end) <= lo).length;
  const later = preview.events.filter((e) => toMin(e.start) >= hi).length;
  const clashes = preview.events.filter((e) => e.overlaps);
  const hours: number[] = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);
  const accepted = preview.status === "accepted";

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-semibold text-slate-900">
          {dayLabel(preview.date, locale)}
          {preview.weekly && <span className="font-normal text-slate-500"> · every week</span>}
        </p>
        <span className={`shrink-0 text-[11px] font-medium uppercase tracking-wide ${accepted ? "text-emerald-700" : "text-slate-400"}`}>
          {accepted ? "✓ Saved" : "Preview"}
        </span>
      </div>
      {preview.from && !ghost && (
        <p className="px-3 pt-2 text-xs text-slate-500">
          Moving from {dayLabel(preview.from.date, locale, { weekday: "short", day: "numeric", month: "short" })}, {preview.from.start}–{preview.from.end}
        </p>
      )}
      {earlier > 0 && <p className="px-3 pt-2 text-[11px] text-slate-400">{earlier} earlier that day</p>}

      <div className="relative mx-3 my-2" style={{ height: (hi - lo) * PX_PER_MIN }} aria-label={`Timeline from ${hours[0] / 60}:00`}>
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
            was {preview.from!.start}–{preview.from!.end}
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
            {preview.start}–{preview.end} · {preview.action === "add" ? "new" : "moved"}
          </span>
        </div>
      </div>

      {later > 0 && <p className="px-3 pb-1 text-[11px] text-slate-400">{later} later that day</p>}
      {clashes.length > 0 && (
        <p className="mx-3 mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">
          Overlaps {clashes.map((e) => `${e.title} (${e.start}–${e.end})`).join(", ")}
        </p>
      )}
      {actions && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">{actions}</div>}
    </div>
  );
}
