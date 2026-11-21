"use client";

import Link from "next/link";
import { useState } from "react";
import type { AttendanceStatus } from "@/db/schema";
import { useLocale, useT } from "@/i18n/client";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { kindLabel } from "@/lib/kinds";
import type { CalEvent } from "@/lib/schedule";
import { capitalize, dayName, formatDate, formatMinutes, formatTimeSlot, nowLocal, weekday } from "@/lib/time";
import { SCHEDULE_CHANGED, kindStyle } from "./Calendar";
import { MakeupFinder } from "./MakeupFinder";
import { Modal } from "./Modal";
import { TripSuggestions } from "./TripSuggestions";

const toClock = (min: number) => formatMinutes(min);
const fromClock = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function EventDialog({ event, onHidden, onClose }: { event: CalEvent; onHidden: (title: string) => void; onClose: () => void }) {
  const messages = useT();
  const t = messages.calendar.event;
  const locale = useLocale();
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(weekday(event.date));
  const [start, setStart] = useState(toClock(event.startMin));
  const [end, setEnd] = useState(toClock(event.endMin));
  const [room, setRoom] = useState(event.room ?? "");
  const [makeup, setMakeup] = useState(false);
  const style = kindStyle(event.kind);
  // Labs, seminars and projects are held per group, so another group's session can stand in for a missed one.
  const canMakeUp = event.type === "class" && (event.kind === "lab" || event.kind === "seminar" || event.kind === "project");
  // A room in a building (not "online") can be walked to on the Campus page.
  const academic = event.type === "class" || event.type === "exam";
  const destination = event.campusRoom ?? (academic && event.place ? event.room : null);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t.saveFailed);
      if (body.action === "hide") onHidden(event.title);
      window.dispatchEvent(new Event(SCHEDULE_CHANGED));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={event.title} onClose={onClose}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          {kindLabel(event.kind, locale)}
        </span>
        <span className="text-slate-700">
          {capitalize(formatDate(event.date, undefined, locale))} · {formatTimeSlot(event.startMin, event.endMin)}
        </span>
      </p>
      <dl className="mb-4 grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm">
        {(event.room || academic) && (<><dt className="text-slate-500">{t.room}</dt><dd className="font-medium text-slate-900">{event.room ?? messages.exams.card.roomUnknown}</dd></>)}
        {event.place && (<><dt className="text-slate-500">{t.building}</dt><dd className="text-slate-800">{event.place.approximate ? messages.campus.rooms.approximate(event.place.name) : event.place.name}{event.place.address ? `, ${event.place.address}` : ""}</dd></>)}
        {event.teacher && (<><dt className="text-slate-500">{t.teacher}</dt><dd className="text-slate-800">{event.teacher}</dd></>)}
        {event.note && (<><dt className="text-slate-500">{t.note}</dt><dd className="text-slate-800">{event.note}</dd></>)}
      </dl>

      <AttendanceControl event={event} />

      {event.place && <TripSuggestions room={event.room} startMin={event.startMin} />}

      {(destination || canMakeUp) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {destination && (
            <Link
              href={campusJourneyHref({ to: destination, building: event.place?.name, course: event.title, at: formatMinutes(event.startMin), date: event.date })}
              className="btn-secondary"
              onClick={onClose}
            >
              <span aria-hidden>🧭</span>
              {messages.guide.buildings.walkthrough}
            </Link>
          )}
          {canMakeUp && (
            <button type="button" className="btn-secondary" onClick={() => setMakeup(true)}>
              <span aria-hidden>🔁</span>
              {messages.study.makeup.open}
            </button>
          )}
        </div>
      )}
      {makeup && <MakeupFinder course={event.title} kind={event.kind} onClose={() => setMakeup(false)} />}

      {event.groupEventId && <Link href={`/contacts/events/${event.groupEventId}`} className="btn-secondary">{t.groupLink}</Link>}

      {event.type === "class" && event.entryId && !moving && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button className="btn-secondary" disabled={busy} onClick={() => setMoving(true)}>{t.move}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => send({ action: "hide", entryId: event.entryId })}>{t.hide}</button>
          {event.moved && (
            <button className="btn-ghost" disabled={busy} onClick={() => send({ action: "reset", entryId: event.entryId, date: event.originalDate })}>
              {event.originalDate ? t.undoWeek : t.undoChange}
            </button>
          )}
        </div>
      )}

      {moving && (
        <form
          className="mt-4 space-y-3 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: "move", entryId: event.entryId, day, startMin: fromClock(start), endMin: fromClock(end), room });
          }}
        >
          <p className="text-sm text-slate-600">{t.moveHint}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="label">{t.weekday}</span>
              <select className="field" value={day} onChange={(e) => setDay(+e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (<option key={d} value={d}>{dayName(d, locale)}</option>))}
              </select>
            </label>
            <label className="text-sm"><span className="label">{t.from}</span><input type="time" className="field" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
            <label className="text-sm"><span className="label">{t.to}</span><input type="time" className="field" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
            <label className="col-span-2 text-sm"><span className="label">{t.room}</span><input className="field" value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t.unchanged} /></label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>{messages.common.actions.save}</button>
            <button type="button" className="btn-ghost" onClick={() => setMoving(false)}>{messages.common.actions.cancel}</button>
          </div>
        </form>
      )}

      {event.type === "personal" && event.personalId && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <button className="btn-danger" disabled={busy} onClick={() => send({ action: "deletePersonal", id: event.personalId })}>
            {event.note === messages.common.time.everyWeek ? t.deleteAll : t.delete}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

const ATTENDANCE_OPTIONS = [
  { value: "attended", label: "markAttended", active: "bg-emerald-600 text-white" },
  { value: "missed", label: "markMissed", active: "bg-red-600 text-white" },
  { value: null, label: "notMarked", active: "bg-slate-600 text-white" },
] as const satisfies ReadonlyArray<{ value: AttendanceStatus | null; label: string; active: string }>;

/** Attended / Missed toggle for this one occurrence; other dates of the series are untouched. */
function AttendanceControl({ event }: { event: CalEvent }) {
  const t = useT().calendar.attendance;
  const locale = useLocale();
  const [status, setStatus] = useState<AttendanceStatus | null>(event.attendance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same rule as the server: an occurrence can be marked from its day onwards.
  const markable = event.date <= nowLocal().date;

  const save = async (next: AttendanceStatus | null) => {
    if (next === status) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: event.id, date: event.date, status: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? t.saveFailed);
      setStatus(next);
      window.dispatchEvent(new Event(SCHEDULE_CHANGED));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 p-3">
      <p className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-900">{t.title}</span>
        <span className="text-xs text-slate-500">{t.onlyOn(formatDate(event.date, { weekday: "short", day: "numeric", month: "short" }, locale))}</span>
      </p>
      <div role="group" aria-label={t.title} className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
        {ATTENDANCE_OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={!markable || busy}
            aria-pressed={status === o.value}
            onClick={() => void save(o.value)}
            className={`flex-1 rounded-md px-2 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${status === o.value ? o.active : "text-slate-600 hover:bg-slate-100"}`}
          >
            {t[o.label]}
          </button>
        ))}
      </div>
      {!markable && <p className="mt-2 text-xs text-slate-500">{t.notYet}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
