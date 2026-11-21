import Link from "next/link";
import { Calendar } from "@/components/Calendar";
import { NextUp } from "@/components/NextUp";
import { QuickActions } from "@/components/QuickActions";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { courseChoices, currentSemester, describeGroup, eventsBetween, teachingWeek } from "@/lib/schedule";
import { addDays, mondayOf, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.calendar.page.title };
}

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const t = await getT();
  const locale = await getLocale();
  const { date: today, minutes } = nowLocal();
  const from = mondayOf(today);
  const to = addDays(from, 6);
  const semester = currentSemester();
  const group = describeGroup(user.groupId, locale);
  const pending = semester
    ? courseChoices(user, semester).filter((c) => c.enrolled && c.slots.length > 0 && !c.chosenSlotId)
    : [];

  return (
    <div className="mx-auto grid w-full max-w-[1200px] min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        <QuickActions name={user.name} hour={Math.floor(minutes / 60)} />
        <NextUp initial={eventsBetween(user, today, addDays(today, 14), locale)} />
        {pending.length > 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t.calendar.page.pendingSlots(pending.length, pending[0].name)}{" "}
            <Link href="/settings#courses" className="font-semibold underline">{t.calendar.page.chooseSlots}</Link>
          </p>
        )}
        <Calendar
          initialEvents={eventsBetween(user, from, to, locale)}
          initialFrom={from}
          initialTo={to}
          initialWeek={semester ? teachingWeek(semester, from) : null}
          today={today}
          hasGroup={!!user.groupId}
        />
        {group && (
          <p className="text-xs text-slate-500">
            {group.faculty.shortName ?? group.faculty.name} · {group.spec.name} · {t.common.time.year(group.group.year)} · {group.label === t.common.time.wholeYear ? group.label : t.common.time.group(group.label)}
            {semester ? ` · ${t.common.time.semester(semester.number, semester.academicYear)}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
