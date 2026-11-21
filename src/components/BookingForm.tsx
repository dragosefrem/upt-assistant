"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bookAction } from "@/app/(app)/contacts/actions";
import type { FreeSlot } from "@/lib/schedule";
import { formatDate, formatMinutes } from "@/lib/time";
import { InvitationForm } from "./InvitationForm";

function BookingTime({ slot, earliestReply }: { slot: FreeSlot; earliestReply: string }) {
  const rounded = Math.ceil(slot.startMin / 15) * 15;
  const morning = Math.max(9 * 60, rounded);
  const initial = morning + 60 <= slot.endMin ? morning : rounded < slot.endMin ? rounded : slot.startMin;
  const [start, setStart] = useState(formatMinutes(initial));
  const [duration, setDuration] = useState(String(Math.min(60, slot.endMin - initial)));
  const [deadline, setDeadline] = useState<string | null>(null);
  const [hours, minutes] = start.split(":").map(Number);
  const room = slot.endMin - hours * 60 - minutes;
  const startsAt = `${slot.date}T${start}`;
  return (
    <>
      <input type="hidden" name="date" value={slot.date} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Start time</span>
          <input name="start" type="time" className="field" required value={start} onChange={(e) => setStart(e.target.value)}
            min={formatMinutes(slot.startMin)} max={formatMinutes(slot.endMin - 1)} />
        </label>
        <label><span className="label">Duration (minutes)</span>
          <input name="duration" type="number" className="field" value={duration} onChange={(e) => setDuration(e.target.value)}
            min={1} max={Number.isFinite(room) ? room : undefined} required />
        </label>
      </div>
      <label className="block"><span className="label">Reply deadline (Timișoara time)</span>
        <input name="deadline" type="datetime-local" className="field" min={earliestReply} max={startsAt}
          value={deadline ?? startsAt} onChange={(e) => setDeadline(e.target.value)} required />
      </label>
    </>
  );
}

const slotKey = (slot: FreeSlot) => `${slot.date}-${slot.startMin}-${slot.endMin}`;

export function BookingForm({ slots, contactIds, earliestReply }: {
  slots: FreeSlot[]; contactIds: string[]; earliestReply: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [share, setShare] = useState(contactIds.length === 0);
  const selected = slots.find((slot) => slotKey(slot) === choice) ?? slots[0];
  return (
    <>
      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Free together this week</h2>
          <button type="button" className="btn-ghost" onClick={() => router.refresh()}>Refresh times</button>
        </div>
        {selected ? <p className="text-sm text-slate-600">Choose a free window. All times are in Timișoara.</p>
          : <p className="text-sm text-slate-600">There’s no shared free time left this week.</p>}
        {[...new Set(slots.map((s) => s.date))].map((date) => (
          <div key={date} className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[9rem_1fr] sm:items-baseline">
            <h3 className="text-sm font-medium">{formatDate(date, { weekday: "short", day: "numeric", month: "short" })}</h3>
            <div className="flex flex-wrap gap-2">{slots.filter((s) => s.date === date).map((s) => {
              const active = s === selected;
              return <button key={slotKey(s)} type="button" aria-pressed={active} onClick={() => setChoice(slotKey(s))}
                className={`rounded-lg border px-3 py-1.5 text-sm tabular-nums ${active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700 hover:bg-brand-50"}`}>
                {formatMinutes(s.startMin)}–{formatMinutes(s.endMin)}
              </button>;
            })}</div>
          </div>
        ))}
      </section>
      {selected && <section className="card space-y-4 p-5">
        <h2 className="text-lg font-semibold">Book {formatDate(selected.date, { weekday: "long", day: "numeric", month: "short" })}</h2>
        <InvitationForm action={bookAction} className="space-y-4">
          {contactIds.map((id) => <input key={id} type="hidden" name="person" value={id} />)}
          <label className="block"><span className="label">Event name</span>
            <input name="title" className="field" placeholder="Football night" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <BookingTime key={slotKey(selected)} slot={selected} earliestReply={earliestReply} />
          <label className="block"><span className="label">Location (optional)</span>
            <input name="location" className="field" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          {contactIds.length > 0 ? <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="share" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Create a link that anyone can use to join
          </label> : <><input type="hidden" name="share" value="on" /><p className="text-sm text-slate-600">You’ll get a link guests can use to join without an account.</p></>}
          <p className="text-sm text-slate-600">You count as going. The event confirms when everyone accepts, or with at least two people at the deadline.</p>
          <button className="btn-primary">{contactIds.length ? "Send invitations" : "Create guest invitation"}</button>
        </InvitationForm>
      </section>}
    </>
  );
}
