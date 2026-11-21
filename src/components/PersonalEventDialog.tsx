"use client";

import { useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { CalEvent } from "@/lib/schedule";
import { dayName, formatMinutes, weekday } from "@/lib/time";
import { SCHEDULE_CHANGED } from "./Calendar";
import { Modal } from "./Modal";

export function PersonalEventDialog({
  defaultDate, defaultStartMin = 18 * 60, defaultEndMin, event, onClose, onSaved,
}: {
  defaultDate: string;
  defaultStartMin?: number;
  defaultEndMin?: number;
  event?: CalEvent;
  onClose: () => void;
  onSaved?: (title: string) => void;
}) {
  const messages = useT();
  const t = messages.calendar.personal;
  const locale = useLocale();
  const existing = event?.personalEditor;
  const initial = existing?.interval;
  const initialDate = initial?.date ?? defaultDate;
  const initialEnd = initial?.endDate ?? initialDate;
  const [title, setTitle] = useState(existing?.title ?? event?.title ?? "");
  const [location, setLocation] = useState(existing?.location ?? event?.room ?? "");
  const [weekly, setWeekly] = useState(existing?.weekly ?? false);
  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialEnd);
  const [day, setDay] = useState(weekday(initialDate));
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const startClock = formatMinutes((initial?.startMin ?? defaultStartMin) % 1440);
  const endClock = formatMinutes((initial?.endMin ?? defaultEndMin ?? Math.min(defaultStartMin + 60, 1440)) % 1440);
  const [start, setStart] = useState(startClock);
  const [end, setEnd] = useState(endClock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weekdayPattern = weekly && !existing?.pattern;
  const minutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const changed = date !== initialDate || endDate !== initialEnd || day !== weekday(initialDate) || weekly !== !!existing?.weekly
      || start !== startClock || end !== endClock || allDay !== !!initial?.allDay;
    const interval = { ...(weekdayPattern ? { day } : { date, endDate, allDay }),
      startMin: allDay ? 0 : minutes(start), endMin: allDay || (end === "00:00" && (weekdayPattern || endDate === date)) ? 1440 : minutes(end) };
    try {
      const res = await fetch("/api/schedule", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: event ? "updatePersonal" : "addPersonal", id: event?.personalId, title, location,
          ...(!event || changed ? interval : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t.saveFailed);
      window.dispatchEvent(new Event(SCHEDULE_CHANGED));
      onSaved?.(title.trim());
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={event ? (existing?.weekly ? t.editSeries : t.edit) : t.title} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm"><span className="label">{t.name}</span><input className="field" value={title} onChange={e => setTitle(e.target.value)} placeholder={t.namePlaceholder} required autoFocus /></label>
        {existing?.pattern ? <p className="text-sm text-slate-600">{t.patternHint}</p> : (
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" className={weekly ? "btn-secondary" : "btn-primary"} aria-pressed={!weekly} onClick={() => setWeekly(false)}>{t.once}</button>
            <button type="button" className={weekly ? "btn-primary" : "btn-secondary"} aria-pressed={weekly} onClick={() => { setWeekly(true); setAllDay(false); }}>{t.weekly}</button>
          </div>
        )}
        {weekdayPattern ? (
          <label className="block text-sm"><span className="label">{t.weekday}</span>
            <select className="field" value={day} onChange={e => setDay(+e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7].map(d => <option key={d} value={d}>{dayName(d, locale)}</option>)}
            </select>
          </label>
        ) : (<>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm"><span className="label">{t.date}</span><input type="date" className="field" value={date} onChange={e => {
              const next = e.target.value; setDate(next); if (endDate === date || endDate < next) setEndDate(next);
            }} required /></label>
            <label className="text-sm"><span className="label">{t.endDate}</span><input type="date" className="field" min={date} value={endDate} onChange={e => setEndDate(e.target.value)} required /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />{t.allDay}</label>
        </>)}
        {!allDay && <div className="grid grid-cols-2 gap-3">
          <label className="text-sm"><span className="label">{t.from}</span><input type="time" className="field" value={start} onChange={e => setStart(e.target.value)} required /></label>
          <label className="text-sm"><span className="label">{t.to}</span><input type="time" className="field" value={end} onChange={e => setEnd(e.target.value)} required /></label>
        </div>}
        <label className="block text-sm"><span className="label">{t.location}</span><input className="field" value={location} onChange={e => setLocation(e.target.value)} /></label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button className="btn-primary" disabled={busy}>{busy ? messages.common.status.saving : event ? messages.common.actions.save : t.submit}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{messages.common.actions.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}
