"use client";

import { saveCoursesAction } from "@/app/onboarding/actions";
import { useLocale, useT } from "@/i18n/client";
import { kindLabel } from "@/lib/kinds";
import type { CourseChoice } from "@/lib/schedule";
import { dayName, formatMinutes } from "@/lib/time";

/**
 * Course enrolment and lab-slot selection. A plain form posting to a server action, so it
 * works before (or without) JavaScript. `submitLabel` defaults to "Save choices".
 */
export function CourseChoicesForm({ choices, returnTo, submitLabel }: { choices: CourseChoice[]; returnTo: string; submitLabel?: string }) {
  const t = useT();
  const m = t.settings.choices;
  const locale = useLocale();
  const optional = choices.filter((c) => c.selectable);
  const slotOnly = choices.filter((c) => !c.selectable && c.slots.length > 0);

  const slotSelect = (c: CourseChoice) =>
    c.slots.length > 0 && (
      <select name={`slot-${c.courseId}`} aria-label={m.slotFor(c.name)} defaultValue={c.chosenSlotId ?? ""} className="field mt-2 sm:mt-0 sm:w-72">
        <option value="">{c.slotsAreExtra ? m.slotNone : m.slotNotChosen}</option>
        {c.slots.map((s) => (
          <option key={s.entryId} value={s.entryId}>
            {dayName(s.day, locale)} {formatMinutes(s.startMin)}–{formatMinutes(s.endMin)}
            {s.room ? ` · ${s.room}` : ""} ({kindLabel(s.kind, locale)})
          </option>
        ))}
      </select>
    );

  return (
    <form action={saveCoursesAction} className="space-y-8">
      <input type="hidden" name="returnTo" value={returnTo} />
      {optional.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900">{m.yourCourses}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">{m.yourCoursesHint}</p>
          {optional.some((course) => course.slots.length > 0) && <p className="mb-3 text-sm text-slate-600">{m.slotsHint}</p>}
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {optional.map((c) => (
              <li key={c.courseId} className="elective-choice flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name={`enrolled-${c.courseId}`} defaultChecked={c.enrolled} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
                  <span>
                    <span className="font-medium text-slate-900">{c.name}</span>
                    {c.abbr && <span className="ml-2 text-xs text-slate-500">{c.abbr}</span>}
                    {c.isOptional && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{m.optional}</span>}
                  </span>
                </label>
                {slotSelect(c)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {slotOnly.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-900">{m.slotsTitle}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">{m.slotsHint}</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {slotOnly.map((c) => (
              <li key={c.courseId} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm">
                  <span className="font-medium text-slate-900">{c.name}</span>
                  {c.abbr && <span className="ml-2 text-xs text-slate-500">{c.abbr}</span>}
                  {c.slotsAreExtra && <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{m.slotsExtra}</span>}
                </span>
                {slotSelect(c)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!optional.length && !slotOnly.length && (
        <p className="text-sm text-slate-600">{m.nothing}</p>
      )}
      <button className="btn-primary">{submitLabel ?? t.settings.courses.save}</button>
    </form>
  );
}
