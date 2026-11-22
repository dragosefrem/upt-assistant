"use client";

import { useState } from "react";
import { removeExtraCourseAction, saveTimetableAction } from "@/app/(app)/timetable-settings/actions";
import { useLocale, useT } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { kindLabel, kindStyle } from "@/lib/kinds";
import type { ReviewCourse } from "@/lib/schedule";
import { capitalize, dayName, describeWeeks, formatMinutes } from "@/lib/time";

const when = (day: number, startMin: number, endMin: number, locale: Locale) =>
  `${capitalize(dayName(day, locale, "short"))} ${formatMinutes(startMin)}–${formatMinutes(endMin)}`;

/**
 * The student's whole timetable, course by course: a tick for each course they follow and for
 * each of its sessions, and the lab time they attend when a course runs at several times.
 * A plain form posting to a server action, so it also works before JavaScript loads.
 */
export function TimetableReviewForm({ courses }: { courses: ReviewCourse[] }) {
  const t = useT();
  const m = t.timetableSettings.review;
  const locale = useLocale();
  const [enrolled, setEnrolled] = useState(() => new Map(courses.map((c) => [c.courseId, c.enrolled])));

  if (!courses.length) return <p className="text-sm text-slate-600">{m.empty}</p>;

  return (
    <form action={saveTimetableAction} className="space-y-4">
      <ul className="space-y-3">
        {courses.map((c) => {
          const on = enrolled.get(c.courseId) ?? c.enrolled;
          const extra = c.extraGroup;
          return (
            <li key={c.courseId} id={`course-${c.courseId}`} className={`scroll-mt-24 rounded-xl border bg-white ${on ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
              <input type="hidden" name={`course-${c.courseId}`} value="1" />
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
                <label className="flex min-w-0 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name={`enrolled-${c.courseId}`}
                    checked={on}
                    onChange={(e) => setEnrolled((current) => new Map(current).set(c.courseId, e.target.checked))}
                    aria-label={m.attend(c.name)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className={`font-semibold ${on ? "text-slate-900" : "text-slate-500 line-through decoration-slate-400"}`}>{c.name}</span>
                    {c.abbr && <span className="ml-2 text-xs text-slate-500">{c.abbr}</span>}
                    {c.isOptional && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{m.optional}</span>}
                    {extra && (
                      <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">
                        {m.extra(`${extra.specialization} · ${t.common.time.year(extra.year)} · ${extra.label}`)}
                      </span>
                    )}
                  </span>
                </label>
                {extra && (
                  <button type="submit" formAction={removeExtraCourseAction.bind(null, c.courseId)} formNoValidate
                    className="btn-ghost px-2 py-1 text-xs" aria-label={m.removeCourse(c.name)}>
                    {m.remove}
                  </button>
                )}
              </div>

              {/* A disabled fieldset leaves its fields out of the form: an unticked course keeps its sessions as they were. */}
              <fieldset disabled={!on} className={`px-4 pb-3 pt-2 ${on ? "" : "opacity-60"}`}>
                <legend className="sr-only">{c.name}</legend>
                {c.activities.length > 0 && (
                  <ul className="space-y-1 pl-7">
                    {c.activities.map((a) => {
                      const weeks = describeWeeks(a.weeks, locale);
                      const details = [weeks, a.room, a.teacher].filter(Boolean).join(" · ");
                      return (
                        <li key={a.entryId}>
                          <input type="hidden" name={`entry-${a.entryId}`} value="1" />
                          <label className="flex items-start gap-2.5 rounded-lg py-1 text-sm">
                            <input type="checkbox" name={`keep-${a.entryId}`} defaultChecked={!a.hidden}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600" />
                            <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kindStyle(a.kind).dot}`} />
                            <span className="min-w-0">
                              <span className="font-medium text-slate-900">{m.session(kindLabel(a.kind, locale), when(a.day, a.startMin, a.endMin, locale))}</span>
                              {details && <span className="block text-xs text-slate-600">{details}</span>}
                              {a.moved && (
                                <span className="block text-xs text-brand-700">
                                  {m.moved(when(a.moved.day, a.moved.startMin, a.moved.endMin, locale) + (a.moved.room ? ` · ${a.moved.room}` : ""))}
                                </span>
                              )}
                              {a.hidden && <span className="block text-xs text-slate-500">{m.hiddenNote}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {c.slots.length > 0 && (
                  <fieldset className="mt-2 rounded-lg bg-amber-50/60 px-3 py-2 sm:ml-7">
                    <legend className="sr-only">{t.settings.choices.slotFor(c.name)}</legend>
                    <p className="text-sm font-semibold text-slate-900">{m.slots}</p>
                    <p className="mb-1.5 text-xs text-slate-600">{m.slotsHint}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {c.slots.map((s) => (
                        <label key={s.entryId} className="flex items-start gap-2 py-0.5 text-sm">
                          <input type="radio" name={`slot-${c.courseId}`} value={s.entryId} defaultChecked={c.chosenSlotId === s.entryId}
                            className="mt-1 shrink-0 accent-brand-600" />
                          <span>
                            {kindLabel(s.kind, locale)} · {when(s.day, s.startMin, s.endMin, locale)}
                            {s.room && <span className="text-slate-500"> · {s.room}</span>}
                          </span>
                        </label>
                      ))}
                      <label className="flex items-start gap-2 py-0.5 text-sm text-slate-600">
                        <input type="radio" name={`slot-${c.courseId}`} value="" defaultChecked={!c.chosenSlotId} className="mt-1 shrink-0 accent-brand-600" />
                        {m.later}
                      </label>
                    </div>
                  </fieldset>
                )}

                {!c.activities.length && !c.slots.length && <p className="pl-7 text-xs text-slate-500">{m.noSessions}</p>}
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="confirm" value="1" className="btn-primary">{m.confirm}</button>
        <button type="submit" name="confirm" value="0" className="btn-secondary">{m.save}</button>
      </div>
    </form>
  );
}
