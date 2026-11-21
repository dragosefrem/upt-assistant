import Link from "next/link";
import { notFound } from "next/navigation";
import { kindStyle } from "@/lib/kinds";
import { requireOnboardedUser } from "@/lib/auth";
import { contactWeek } from "@/lib/contact-schedule";
import { addDays, formatDate, formatMinutes, nowLocal } from "@/lib/time";

export const metadata = { title: "Contact schedule" };

export default async function ContactSchedulePage({ params, searchParams }: PageProps<"/contacts/[id]/schedule">) {
  const viewer = await requireOnboardedUser();
  const { id } = await params;
  const { week } = await searchParams;
  const today = nowLocal().date;
  const schedule = contactWeek(viewer.id, id, typeof week === "string" ? week : undefined);
  if (!schedule) notFound();

  const path = `/contacts/${encodeURIComponent(id)}/schedule`;
  const planningDates = schedule.from > today ? { from: schedule.from, to: schedule.to } : {};
  const shortDate = (date: string) => formatDate(date, { day: "numeric", month: "short" });
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/contacts" className="text-sm font-medium text-brand-700 hover:underline">← Contacts</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">{schedule.name}’s schedule</h1>
          {schedule.group && <p className="mt-1 text-sm text-slate-600">{schedule.group}</p>}
        </div>
        <Link href={{ pathname: "/contacts/plan", query: { find: "1", person: id, ...planningDates } }} className="btn-primary">Find time together</Link>
      </header>
      <section className="card overflow-hidden" aria-labelledby="week-heading">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="week-heading" className="font-semibold">{shortDate(schedule.from)} – {formatDate(schedule.to, { day: "numeric", month: "short", year: "numeric" })}</h2>
            <p className="text-xs text-slate-500">Timișoara time</p>
          </div>
          <nav aria-label="Schedule weeks" className="flex items-center gap-1">
            <Link href={`${path}?week=${addDays(schedule.from, -7)}`} aria-label="Previous week" className="btn-ghost">← Previous</Link>
            <Link href={path} className="btn-secondary">This week</Link>
            <Link href={`${path}?week=${addDays(schedule.from, 7)}`} aria-label="Next week" className="btn-ghost">Next →</Link>
          </nav>
        </header>
        {schedule.events.length === 0 ? <p className="p-5 text-sm text-slate-600">No events scheduled this week.</p> :
          Array.from({ length: 7 }, (_, i) => addDays(schedule.from, i)).map((date) => {
            const events = schedule.events.filter((event) => event.date === date);
            return (
              <section key={date} className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[8.5rem_1fr]">
                <h3 className={`text-sm font-semibold ${date === today ? "text-brand-700" : "text-slate-700"}`}>
                  <time dateTime={date}>{formatDate(date, { weekday: "short", day: "numeric", month: "short" })}</time>
                  {date === today && <span className="ml-1 text-xs font-normal">Today</span>}
                </h3>
                {events.length === 0 ? <p className="text-sm text-slate-500">No events</p> :
                  <ul className="space-y-2">
                    {events.map((event, index) => {
                      const style = kindStyle(event.kind);
                      return (
                        <li key={index} className="grid grid-cols-[6rem_1fr] items-baseline gap-2 text-sm">
                          <span className="text-slate-600 tabular-nums">{formatMinutes(event.startMin)}–{formatMinutes(event.endMin)}</span>
                          <div className="min-w-0 border-l-2 border-slate-200 pl-2">
                            <p className="break-words font-medium">{event.title}</p>
                            {event.kind !== "busy" && <p className="flex items-baseline gap-1.5 text-xs text-slate-600">
                              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                              <span>{style.label}{event.room && ` · ${event.room}`}</span>
                            </p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>}
              </section>
            );
          })}
      </section>
    </div>
  );
}
