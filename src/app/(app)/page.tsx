import Link from "next/link";
import { Calendar } from "@/components/Calendar";
import { NextUp } from "@/components/NextUp";
import { WelcomeTour } from "@/components/WelcomeTour";
import { WeekLabs } from "@/components/WeekLabs";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { programmeTimetable } from "@/lib/catalog";
import { holidaysBetween } from "@/lib/holidays";
import { courseChoices, currentSemester, describeGroup, eventsBetween, teachingWeek, needsSlot } from "@/lib/schedule";
import { sponsoredOffers } from "@/lib/sponsored-events";
import { addDays, mondayOf, nowLocal } from "@/lib/time";
import { withUptCalendar } from "@/lib/upt-events";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.calendar.page.title };
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireOnboardedUser();
  const t = await getT();
  const locale = await getLocale();
  const { date: today } = nowLocal();
  const horizon = addDays(today, 14);
  const start = mondayOf(today);
  const end = addDays(mondayOf(horizon), 6);
  const scheduled = eventsBetween(user, start, end, locale);
  const { events, uptSubscribed } = withUptCalendar(user, start, end, scheduled);
  const nextEvents = events.filter((item) => item.date >= today && item.date <= horizon);
  const { date, event } = await searchParams;
  const selected = nextEvents.find((item) => item.id === event && item.date === date);
  const from = mondayOf(selected?.date ?? today);
  const to = addDays(from, 6);
  const semester = currentSemester();
  const group = describeGroup(user.groupId, locale);
  const pending = semester
    ? courseChoices(user, semester).filter(needsSlot)
    : [];

  return (
    <div className="space-y-5">
      <header className="page-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1>{t.calendar.page.heading}</h1>
          {!user.welcomeSeenAt && <WelcomeTour name={user.name} />}
        </div>
        {group && (
          <p className="mt-1.5 text-sm text-slate-600">
            {group.faculty.shortName ?? group.faculty.name} · {group.spec.name} · {t.common.time.year(group.group.year)} · {group.label === t.common.time.wholeYear ? group.label : t.common.time.group(group.label)}
            {semester ? ` · ${t.common.time.semester(semester.number, semester.academicYear)}` : ""}
          </p>
        )}
      </header>
      {pending.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t.calendar.page.pendingSlots(pending.length, pending[0].name)}{" "}
          <Link href="/settings#courses" className="font-semibold underline">{t.calendar.page.chooseSlots}</Link>
        </p>
      )}
      <div className="schedule-layout">
        <NextUp initial={nextEvents} />
        <Calendar
          key={selected?.id ?? "current-week"}
          initialSelection={selected}
          initialEvents={events.filter((e) => e.date >= from && e.date <= to)}
          initialOffers={sponsoredOffers(user, from, from === start ? horizon : to, scheduled)}
          initialUptSubscribed={uptSubscribed}
          initialHolidays={holidaysBetween(from, to, locale)}
          initialFrom={from}
          initialTo={to}
          initialWeek={semester ? teachingWeek(semester, from) : null}
          today={today}
          hasGroup={!!user.groupId}
          programme={user.groupId ? null : programmeTimetable(user.specializationId)}
          year={user.year}
        />
        <WeekLabs user={user} date={today} locale={locale} />
      </div>
    </div>
  );
}
