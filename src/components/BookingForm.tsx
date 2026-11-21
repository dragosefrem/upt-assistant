"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bookAction } from "@/app/(app)/contacts/actions";
import { useLocale, useT } from "@/i18n/client";
import type { DateRange } from "@/lib/planning-range";
import type { FreeSlot } from "@/lib/schedule";
import { addDays, formatDate, formatMinutes } from "@/lib/time";
import { AvailabilityCharts, availabilityDays, hourViews, windowLabel } from "./AvailabilityCharts";
import { InvitationForm } from "./InvitationForm";

function BookingTime({ slot, earliestReply }: { slot: FreeSlot; earliestReply: string }) {
  const t = useT().contacts.booking;
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
        <label><span className="label">{t.startTime}</span>
          <input name="start" type="time" className="field" required value={start} onChange={(e) => setStart(e.target.value)}
            min={formatMinutes(slot.startMin)} max={formatMinutes(slot.endMin - 1)} />
        </label>
        <label><span className="label">{t.duration}</span>
          <input name="duration" type="number" className="field" value={duration} onChange={(e) => setDuration(e.target.value)}
            min={1} max={Number.isFinite(room) ? room : undefined} required />
        </label>
      </div>
      <label className="block"><span className="label">{t.deadline}</span>
        <input name="deadline" type="datetime-local" className="field" min={earliestReply} max={startsAt}
          value={deadline ?? startsAt} onChange={(e) => setDeadline(e.target.value)} required />
      </label>
    </>
  );
}

const slotKey = (slot: FreeSlot) => `${slot.date}-${slot.startMin}-${slot.endMin}`;

export function BookingForm({ slots, range, contactIds, asOf }: {
  slots: FreeSlot[]; range: DateRange; contactIds: string[]; asOf: { date: string; minutes: number };
}) {
  const messages = useT().contacts;
  const t = messages.booking;
  const locale = useLocale();
  const router = useRouter();
  const [choice, setChoice] = useState<{ date: string; start?: number } | null>(null);
  const [hourView, setHourView] = useState(0);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [share, setShare] = useState(contactIds.length === 0);
  const hours = hourViews[hourView];
  const days = availabilityDays(range, slots, asOf, hours);
  const earliestReply = asOf.minutes === 1439 ? `${addDays(asOf.date, 1)}T00:00` : `${asOf.date}T${formatMinutes(asOf.minutes + 1)}`;
  const day = days.find((d) => d.date === choice?.date) ?? days.find((d) => d.slots.length > 0) ?? days[0];
  const selected = day.slots.find((s) => choice?.date === day.date && s.startMin === choice.start)
    ?? day.slots.find((s) => s.endMin - s.startMin >= 60) ?? day.slots[0];
  const heading = formatDate(day.date, { weekday: "long", day: "numeric", month: "long" }, locale);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2 font-medium text-slate-700">{t.showHours}
          <select value={hourView} onChange={(e) => setHourView(Number(e.target.value))} className="field w-auto">
            {hourViews.map((view, i) => <option key={view.id} value={i}>{messages.availability.hours[view.id]}</option>)}
          </select>
        </label>
        <p className="grow text-slate-600">{t.hint}</p>
        <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => router.refresh()}>{t.refresh}</button>
      </div>
      <AvailabilityCharts days={days} selectedDay={day} selectedSlot={selected} asOf={asOf} hours={hours}
        onSelect={(date, slot) => setChoice({ date, start: slot?.startMin })} />
      <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="booking-day">
        <h2 id="booking-day" aria-live="polite" className="text-lg font-semibold tracking-tight">{t.openingsFor(heading)}</h2>
        {day.slots.length ? <div role="group" aria-label={t.windows} className="flex flex-wrap gap-2">
          {day.slots.map((slot) => <button key={slot.startMin} type="button" aria-pressed={slot === selected}
            onClick={() => setChoice({ date: day.date, start: slot.startMin })}
            className={`rounded-lg border px-3 py-2 text-sm font-medium tabular-nums ${slot === selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700 hover:bg-brand-50"}`}>
            {windowLabel(slot)}
          </button>)}
        </div> : <p className="text-sm text-slate-600">{t.noOpenings}</p>}
        {selected && <InvitationForm action={bookAction} className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          {contactIds.map((id) => <input key={id} type="hidden" name="person" value={id} />)}
          <label className="block"><span className="label">{t.eventName}</span>
            <input name="title" className="field" placeholder={t.eventPlaceholder} maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block"><span className="label">{t.location}</span>
            <input name="location" className="field" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <BookingTime key={slotKey(selected)} slot={selected} earliestReply={earliestReply} />
          {contactIds.length > 0 ? <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="share" checked={share} onChange={(e) => setShare(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            {t.shareLink}
          </label> : <><input type="hidden" name="share" value="on" /><p className="text-sm text-slate-600">{t.guestNote}</p></>}
          <p className="text-sm text-slate-600 sm:col-span-2">{t.rule}</p>
          <button className="btn-primary justify-self-start">{contactIds.length ? t.send : t.createGuest}</button>
        </InvitationForm>}
      </section>
    </>
  );
}
