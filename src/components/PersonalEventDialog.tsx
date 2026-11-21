"use client";

import { useState } from "react";
import { DAY_NAMES, formatMinutes, weekday } from "@/lib/time";
import { SCHEDULE_CHANGED } from "./Calendar";
import { Modal } from "./Modal";

export function PersonalEventDialog({
  defaultDate,
  defaultStartMin = 18 * 60,
  defaultEndMin,
  onClose,
  onSaved,
}: {
  defaultDate: string;
  defaultStartMin?: number;
  defaultEndMin?: number;
  onClose: () => void;
  onSaved?: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [day, setDay] = useState(weekday(defaultDate));
  const [start, setStart] = useState(formatMinutes(defaultStartMin));
  const [end, setEnd] = useState(formatMinutes(Math.min(defaultEndMin ?? defaultStartMin + 60, 23 * 60 + 59)));
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutes = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "addPersonal",
          title,
          ...(weekly ? { day } : { date }),
          startMin: minutes(start),
          endMin: minutes(end),
          location,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The event could not be saved.");
      window.dispatchEvent(new Event(SCHEDULE_CHANGED));
      onSaved?.(title.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a personal event" onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm"><span className="label">Title</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Study group, gym, part-time job…" required autoFocus /></label>
        <div className="flex gap-2 text-sm">
          <button type="button" className={weekly ? "btn-secondary" : "btn-primary"} onClick={() => setWeekly(false)}>Once</button>
          <button type="button" className={weekly ? "btn-primary" : "btn-secondary"} onClick={() => setWeekly(true)}>Every week</button>
        </div>
        {weekly ? (
          <label className="block text-sm">
            <span className="label">Weekday</span>
            <select className="field" value={day} onChange={(e) => setDay(+e.target.value)}>
              {DAY_NAMES.slice(1).map((d, i) => (<option key={d} value={i + 1}>{d}</option>))}
            </select>
          </label>
        ) : (
          <label className="block text-sm"><span className="label">Date</span><input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm"><span className="label">From</span><input type="time" className="field" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className="text-sm"><span className="label">To</span><input type="time" className="field" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
        </div>
        <label className="block text-sm"><span className="label">Location (optional)</span><input className="field" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Add event"}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
