import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { messagesFor } from "@/i18n/server";
import type { User } from "@/lib/auth";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { kindLabel, kindStyle } from "@/lib/kinds";
import { practicalsInWeek } from "@/lib/labs";
import { capitalize, dayName, describeWeeks, formatDate, formatTimeSlot, weekday } from "@/lib/time";
import { MakeupButton } from "./MakeupFinder";

/**
 * "Do I have lab this week?" answered on the home page: the labs, seminars and projects
 * that take place this week, and the ones that do not, with the date they come next.
 */
export function WeekLabs({ user, date, locale }: { user: User; date: string; locale: Locale }) {
  const t = messagesFor(locale).study.labs;
  const week = practicalsInWeek(user, date);
  if (!user.groupId || (!week.running.length && !week.skipped.length)) return null;
  const shortDate = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" }, locale);

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="week-labs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="week-labs" className="text-base font-semibold text-slate-900">🧪 {t.title}</h2>
        {week.week !== null && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${week.parity === "odd" ? "bg-violet-50 text-violet-700" : "bg-teal-50 text-teal-700"}`}>
            {week.parity === "odd" ? t.weekOdd(week.week) : t.weekEven(week.week)}
          </span>
        )}
      </div>

      {week.pause && (
        <p className="mt-2 text-sm text-slate-600">
          {week.pause === "holiday" || week.pause === "before-semester"
            ? t.noTeaching[week.pause](week.resumes ? formatDate(week.resumes, { day: "numeric", month: "long" }, locale) : "—")
            : t.noTeaching[week.pause]}
        </p>
      )}

      {!week.pause && (
        <div className="mt-3 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.thisWeek}</h3>
            {week.running.length ? (
              <ul className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {week.running.map((e) => (
                  <li key={e.id} className="flex gap-2 text-sm">
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kindStyle(e.kind).dot}`} />
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">{e.abbr ?? e.title}</span>{" "}
                      <span className="text-slate-500">{kindLabel(e.kind, locale)}</span>
                      <span className="block text-xs text-slate-600">
                        {capitalize(dayName(weekday(e.date), locale, "short"))} <span className="tabular-nums">{formatTimeSlot(e.startMin, e.endMin)}</span>
                        {e.room && (
                          <>
                            {" · "}
                            <Link href={campusJourneyHref({ to: e.room, building: e.place?.name, course: e.title })} className="font-medium text-brand-700 hover:underline">{e.room}</Link>
                          </>
                        )}
                        {" · "}
                        <MakeupButton course={e.title} kind={e.kind} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-slate-600">{t.nothing}</p>
            )}
          </div>
          {week.skipped.length > 0 && (
            <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.notThisWeek}</h3>
              <ul className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {week.skipped.map((e) => (
                  <li key={e.entryId} className="flex gap-2 text-sm text-slate-500">
                    <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    <span className="min-w-0">
                      <span className="font-medium text-slate-700">{e.abbr ?? e.title}</span> {kindLabel(e.kind, locale)}
                      <span className="block text-xs">
                        {[describeWeeks(e.weeks, locale), e.next ? t.next(shortDate(e.next)) : t.finished].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
