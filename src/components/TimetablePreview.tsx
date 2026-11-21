"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { formatMinutes } from "@/lib/time";

type Sample = {
  course: "maths" | "coding" | "physics" | "logic" | "english";
  kind: "course" | "lab" | "seminar" | "exam";
  start: number;
  end: number;
  room: string;
};

// A fixed example teaching week. Gaps appear between the classes that bound them.
const week: Sample[][] = [
  [{ course: "maths", kind: "course", start: 8, end: 10, room: "A101" }, { course: "coding", kind: "lab", start: 10, end: 12, room: "B419" }, { course: "english", kind: "exam", start: 14, end: 16, room: "D1" }],
  [{ course: "physics", kind: "course", start: 10, end: 12, room: "A101" }, { course: "maths", kind: "seminar", start: 14, end: 16, room: "A205" }],
  [{ course: "logic", kind: "course", start: 8, end: 10, room: "A101" }, { course: "physics", kind: "lab", start: 12, end: 14, room: "B305" }],
  [{ course: "coding", kind: "lab", start: 10, end: 12, room: "B419" }, { course: "maths", kind: "seminar", start: 12, end: 14, room: "A205" }],
  [{ course: "coding", kind: "course", start: 8, end: 10, room: "A101" }, { course: "logic", kind: "lab", start: 10, end: 12, room: "B418" }],
];

function SlotTimes({ start, end }: { start: number; end: number }) {
  const from = formatMinutes(start * 60);
  const to = formatMinutes(end * 60);
  return <span className="slot-times"><time dateTime={from}>{from}</time><span className="sr-only"> – </span><time dateTime={to}>{to}</time></span>;
}

export function TimetablePreview() {
  const messages = useT();
  const t = messages.landing.preview;
  const [day, setDay] = useState(0);
  return (
    <section className="preview-sheet" aria-labelledby="preview-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preview-title" className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={17} className="text-brand-600" aria-hidden />{t.title}</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{t.week}</span>
      </div>
      <p className="mt-3 text-xl font-semibold tracking-tight">{t.month}</p>
      <div role="group" aria-label={t.title} className="preview-days">
        {t.shortDays.map((label, i) => (
          <button key={label} type="button" aria-label={t.days[i]} aria-pressed={i === day} onClick={() => setDay(i)}>
            <span>{label}</span><strong>{23 + i}</strong>
          </button>
        ))}
      </div>
      <div className="preview-agenda" aria-live="polite" aria-atomic="true">
        <p className="sr-only">{t.days[day]}</p>
        <ul key={day} className="agenda-enter">
          {week[day].flatMap((item, i, slots) => {
            const previous = slots[i - 1];
            return [
              previous && previous.end < item.start && <li key={`break-${previous.end}`} className="preview-event" data-kind="free">
                <SlotTimes start={previous.end} end={item.start} /><div><strong>{t.free}</strong></div>
              </li>,
              <li key={item.start} className="preview-event" data-kind={item.kind}>
                <SlotTimes start={item.start} end={item.end} />
                <div>
                  <strong>{t.courses[item.course]}</strong>
                  <span>{messages.common.kinds[item.kind]} <span aria-hidden>·</span> <MapPin size={12} aria-hidden />{t.room(item.room)}</span>
                </div>
              </li>,
            ];
          })}
        </ul>
      </div>
    </section>
  );
}
