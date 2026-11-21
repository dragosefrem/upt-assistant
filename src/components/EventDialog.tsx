"use client";

import { useState } from "react";
import type { AttendanceStatus } from "@/db/schema";
import type { CalEvent } from "@/lib/schedule";
import { DAY_NAMES, formatDate, formatMinutes, formatTimeSlot, nowLocal, weekday } from "@/lib/time";
import { SCHEDULE_CHANGED, kindStyle } from "./Calendar";
import { Modal } from "./Modal";
import { TripSuggestions } from "./TripSuggestions";

const toClock = (min: number) => formatMinutes(min);
const fromClock = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function EventDialog({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(weekday(event.date));
  const [start, setStart] = useState(toClock(event.startMin));
  const [end, setEnd] = useState(toClock(event.endMin));
  const [room, setRoom] = useState(event.room ?? "");
  const style = kindStyle(event.kind);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The change could not be saved.");
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
          {style.label}
        </span>
        <span className="text-slate-700">
          {formatDate(event.date)} · {formatTimeSlot(event.startMin, event.endMin)}
        </span>
      </p>
      <dl className="mb-4 grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-sm">
        {event.room && (<><dt className="text-slate-500">Room</dt><dd className="font-medium text-slate-900">{event.room}</dd></>)}
        {event.place && (<><dt className="text-slate-500">Building</dt><dd className="text-slate-800">{event.place.name}{event.place.address ? `, ${event.place.address}` : ""}</dd></>)}
        {event.teacher && (<><dt className="text-slate-500">Teacher</dt><dd className="text-slate-800">{event.teacher}</dd></>)}
        {event.note && (<><dt className="text-slate-500">Note</dt><dd className="text-slate-800">{event.note}</dd></>)}
      </dl>

      <AttendanceControl event={event} />

      {event.place && <TripSuggestions room={event.room} startMin={event.startMin} />}

      {event.type === "class" && event.entryId && !moving && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button className="btn-secondary" disabled={busy} onClick={() => setMoving(true)}>Move…</button>
          <button className="btn-secondary" disabled={busy} onClick={() => send({ action: "hide", entryId: event.entryId })}>Hide from my timetable</button>
          {event.moved && (
            <button className="btn-ghost" disabled={busy} onClick={() => send({ action: "reset", entryId: event.entryId })}>Undo my change</button>
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
          <p className="text-sm text-slate-600">Move this class every week — for example if you attend it with another group. Only your own timetable changes.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="label">Weekday</span>
              <select className="field" value={day} onChange={(e) => setDay(+e.target.value)}>
                {DAY_NAMES.slice(1).map((d, i) => (<option key={d} value={i + 1}>{d}</option>))}
              </select>
            </label>
            <label className="text-sm"><span className="label">From</span><input type="time" className="field" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
            <label className="text-sm"><span className="label">To</span><input type="time" className="field" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
            <label className="col-span-2 text-sm"><span className="label">Room</span><input className="field" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Unchanged" /></label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy}>Save</button>
            <button type="button" className="btn-ghost" onClick={() => setMoving(false)}>Cancel</button>
          </div>
        </form>
      )}

      {event.type === "personal" && event.personalId && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <button className="btn-danger" disabled={busy} onClick={() => send({ action: "deletePersonal", id: event.personalId })}>
            Delete event{event.note === "every week" ? " (all weeks)" : ""}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

const ATTENDANCE_OPTIONS: Array<{ value: AttendanceStatus | null; label: string; active: string }> = [
  { value: "attended", label: "✓ Attended", active: "bg-emerald-600 text-white" },
  { value: "missed", label: "✗ Missed", active: "bg-red-600 text-white" },
  { value: null, label: "Not marked", active: "bg-slate-600 text-white" },
];

/** Attended / Missed toggle for this one occurrence; other dates of the series are untouched. */
function AttendanceControl({ event }: { event: CalEvent }) {
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Attendance could not be saved.");
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
        <span className="font-medium text-slate-900">Attendance</span>
        <span className="text-xs text-slate-500">{formatDate(event.date, { weekday: "short", day: "numeric", month: "short" })} only</span>
      </p>
      <div role="group" aria-label="Attendance" className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
        {ATTENDANCE_OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={!markable || busy}
            aria-pressed={status === o.value}
            onClick={() => void save(o.value)}
            className={`flex-1 rounded-md px-2 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${status === o.value ? o.active : "text-slate-600 hover:bg-slate-100"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {!markable && <p className="mt-2 text-xs text-slate-500">This event has not happened yet. You can mark attendance from its day onwards.</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
