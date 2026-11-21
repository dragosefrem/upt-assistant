"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { formatMinutes } from "@/lib/time";

// A fixed sample teaching week, independent of the visitor's account and today's date.
type Sample = { course: "maths" | "coding" | "physics" | "logic" | "english"; kind: "course" | "lab" | "seminar"; hour: number; room: string };
const week: Sample[][] = [
  [{ course: "maths", kind: "course", hour: 8, room: "A101" }, { course: "coding", kind: "lab", hour: 10, room: "B419" }, { course: "english", kind: "seminar", hour: 14, room: "A205" }],
  [{ course: "physics", kind: "course", hour: 10, room: "A101" }, { course: "maths", kind: "seminar", hour: 14, room: "A205" }],
  [{ course: "logic", kind: "course", hour: 8, room: "A101" }, { course: "physics", kind: "lab", hour: 12, room: "B305" }],
  [{ course: "coding", kind: "lab", hour: 10, room: "B419" }, { course: "maths", kind: "seminar", hour: 12, room: "A205" }],
  [{ course: "coding", kind: "course", hour: 8, room: "A101" }, { course: "logic", kind: "lab", hour: 10, room: "B418" }],
];

export function TimetablePreview() {
  const messages = useT();
  const t = messages.landing.preview;
  const [day, setDay] = useState(0);

  return (
    <section className="preview-desk" aria-labelledby="preview-title">
      <div className="preview-sheet">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="preview-title" className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={17} className="text-brand-600" aria-hidden />{t.title}</h2>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">{t.week}</span>
        </div>
        <p className="mt-5 text-2xl font-semibold tracking-tight">{t.month}</p>
        <div role="group" aria-label={t.title} className="preview-days">
          {t.shortDays.map((label, i) => (
            <button key={i} type="button" aria-label={t.days[i]} aria-pressed={i === day} onClick={() => setDay(i)}>
              <span>{label}</span><strong>{23 + i}</strong>
            </button>
          ))}
        </div>
        <div className="preview-agenda" aria-live="polite" aria-atomic="true">
          <p className="sr-only">{t.days[day]}</p>
          <ul key={day} className="agenda-enter">
            {week[day].map((item) => (
              <li key={item.hour} className="preview-event" data-kind={item.kind}>
                <time>{formatMinutes(item.hour * 60)}</time>
                <div>
                  <strong>{t.courses[item.course]}</strong>
                  <span>{messages.common.kinds[item.kind]} <span aria-hidden>·</span> <MapPin size={12} aria-hidden />{t.room(item.room)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
