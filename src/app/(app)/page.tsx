import Link from "next/link";
import { Calendar } from "@/components/Calendar";
import { ExamCountdown } from "@/components/ExamCountdown";
import { NextUp } from "@/components/NextUp";
import { QuickActions } from "@/components/QuickActions";
import { requireOnboardedUser } from "@/lib/auth";
import { everydayTip } from "@/lib/examTips";
import { examReminders } from "@/lib/reminders";
import { courseChoices, currentSemester, describeGroup, eventsBetween, teachingWeek } from "@/lib/schedule";
import { addDays, mondayOf, nowLocal } from "@/lib/time";

export const metadata = { title: "Calendar" };

export default async function HomePage() {
  const user = await requireOnboardedUser();
  const { date: today, minutes } = nowLocal();
  const from = mondayOf(today);
  const to = addDays(from, 6);
  const semester = currentSemester();
  const group = describeGroup(user.groupId);
  const pending = semester
    ? courseChoices(user, semester).filter((c) => c.enrolled && c.slots.length > 0 && !c.chosenSlotId)
    : [];

  return (
    <div className="mx-auto grid w-full max-w-[1200px] min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        <QuickActions name={user.name} hour={Math.floor(minutes / 60)} />
        <NextUp initial={eventsBetween(user, today, addDays(today, 14))} />
        <ExamCountdown exams={examReminders(user)} tip={everydayTip(today)} />
        {pending.length > 0 && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {pending.length === 1 ? `${pending[0].name} runs` : `${pending.length} of your courses run`} in several lab slots and you
            have not picked one yet, so {pending.length === 1 ? "it is" : "they are"} missing from the calendar.{" "}
            <Link href="/settings#courses" className="font-semibold underline">Choose your slots</Link>
          </p>
        )}
        <Calendar
          initialEvents={eventsBetween(user, from, to)}
          initialFrom={from}
          initialTo={to}
          initialWeek={semester ? teachingWeek(semester, from) : null}
          today={today}
          hasGroup={!!user.groupId}
        />
        {group && (
          <p className="text-xs text-slate-500">
            {group.faculty.shortName ?? group.faculty.name} · {group.spec.name} · year {group.group.year} · group {group.label}
            {semester ? ` · semester ${semester.number}, ${semester.academicYear}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
