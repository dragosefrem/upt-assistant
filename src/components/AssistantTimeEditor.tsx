"use client";

import { CalendarClock, Check, Clock3, Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { DayPreview } from "@/lib/assistant/choices";
import type { CardEvent } from "@/lib/assistant/reply-card";
import { addDays, dayName, formatDate, formatMinutes, weekday } from "@/lib/time";

export type TimeEdit = { date: string; start: string; end: string; weekly?: boolean; occurrence?: string };
type EditorProps = {
  title: string; initial: { date: string; start: string; end: string }; scope: NonNullable<CardEvent["move"]>["scope"];
  busy: boolean; onCancel: () => void; onReview: (time: TimeEdit) => void; original?: string;
};
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const field = "mt-1 block min-w-0 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-medium text-slate-900";

export function EventTimeEditor({ title, original, initial, scope, busy, onCancel, onReview }: EditorProps) {
  const t = useT();
  const tr = t.assistant.preview;
  const locale = useLocale();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [weekly, setWeekly] = useState(scope === "series");
  const [error, setError] = useState(false);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const endAt = end === "00:00" && start > "00:00" ? "24:00" : end;
  const setStartKeepingDuration = (value: string) => {
    const duration = minutes(endAt) - minutes(start);
    if (value && duration > 0) {
      const next = minutes(value) + duration;
      setEnd(next <= 1440 ? formatMinutes(next) : "");
    }
    setStart(value);
  };
  return (
    <form aria-labelledby={id} className="w-full min-w-0 space-y-3 rounded-lg bg-slate-50 p-3" onSubmit={(e) => {
      e.preventDefault();
      if (!date || !start || !endAt || endAt <= start) { setError(true); return; }
      setError(false);
      onReview({ date, start, end: endAt, weekly });
    }}>
      <div>
        <h4 id={id} ref={heading} tabIndex={-1} className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarClock aria-hidden size={16} className="shrink-0 text-brand-700" />{title}</h4>
        {original && <p className="mt-1 text-xs text-slate-600">{original}</p>}
        {scope === "series" && <p className="mt-1 text-xs font-medium text-brand-700">{tr.series}</p>}
      </div>
      {scope === "choose" && (
        <fieldset disabled={busy}>
          <legend className="sr-only">{tr.appliesTo}</legend>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            {[false, true].map((series) => <label key={String(series)} className="relative flex-1">
              <input type="radio" name={id} checked={weekly === series} onChange={() => setWeekly(series)} className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0" />
              <span className="block rounded-md px-2 py-2.5 text-center font-medium text-slate-600 peer-checked:bg-brand-100 peer-checked:text-brand-800 peer-focus-visible:outline-2">{series ? tr.series : tr.once}</span>
            </label>)}
          </div>
        </fieldset>
      )}
      <label className="block text-xs font-medium text-slate-600">{weekly ? tr.weekday : tr.date}
        {weekly ? <select value={weekday(date || initial.date)} disabled={busy} className={field}
          onChange={(e) => { const base = date || initial.date; setDate(addDays(base, Number(e.target.value) - weekday(base))); }}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{dayName(d, locale)}</option>)}
        </select> : <input type="date" required value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} className={field} />}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs font-medium text-slate-600">{tr.start}
          <input type="time" required value={start} disabled={busy} onChange={(e) => setStartKeepingDuration(e.target.value)} className={field} />
        </label>
        <label className="min-w-0 text-xs font-medium text-slate-600">{tr.end}
          <input type="time" required value={end === "24:00" ? "00:00" : end} disabled={busy} onChange={(e) => setEnd(e.target.value)} className={field} />
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{tr.invalidTime}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-3 py-2 text-xs">{tr.reviewTime}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="btn-secondary px-3 py-2 text-xs">{t.common.actions.cancel}</button>
      </div>
    </form>
  );
}

export function PreviewActions({ preview, busy, accept, review }: {
  preview: DayPreview; busy: boolean; accept: () => void; review: (edit: TimeEdit) => void;
}) {
  const tr = useT().assistant.preview;
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  if (editing) return <EventTimeEditor title={preview.title} initial={preview} scope={preview.weekly ? "series" : "once"} busy={busy}
    original={preview.from && tr.movingFrom(formatDate(preview.from.date, undefined, locale), `${preview.from.start}–${preview.from.end}`)}
    onCancel={() => setEditing(false)} onReview={review} />;
  const clashes = preview.events.some((e) => e.overlaps) || !!preview.otherClashes?.length;
  return (
    <div className="w-full space-y-2">
      {!!preview.alternatives?.length && <div role="group" aria-label={tr.alternatives} className="space-y-1">
        <p className="text-xs font-medium text-slate-600">{tr.alternatives}</p>
        <div className="flex flex-wrap gap-1.5">{preview.alternatives.map((slot) => <button type="button" key={slot.start} disabled={busy}
          onClick={() => review({ ...slot, date: preview.date, weekly: preview.weekly })}
          className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium tabular-nums text-teal-800 hover:bg-teal-100">
          <Clock3 aria-hidden size={13} />{slot.start}–{slot.end}
        </button>)}</div>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={accept} className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><Check size={14} aria-hidden />{clashes ? tr.acceptOverlap : tr.accept}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(true)} className="btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"><Pencil size={13} aria-hidden />{tr.edit}</button>
      </div>
    </div>
  );
}
