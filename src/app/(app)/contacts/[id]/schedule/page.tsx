import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getT } from "@/i18n/server";
import { kindLabel, kindStyle } from "@/lib/kinds";
import { requireOnboardedUser } from "@/lib/auth";
import { contactWeek } from "@/lib/contact-schedule";
import { addDays, capitalize, formatDate, formatMinutes, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.contacts.schedule.title };
}

export default async function ContactSchedulePage({ params, searchParams }: PageProps<"/contacts/[id]/schedule">) {
  const viewer = await requireOnboardedUser();
  const { id } = await params;
  const { week } = await searchParams;
  const messages = await getT();
  const t = messages.contacts.schedule;
  const locale = await getLocale();
  const today = nowLocal().date;
  const schedule = contactWeek(viewer.id, id, typeof week === "string" ? week : undefined, locale);
  if (!schedule) notFound();

  const path = `/contacts/${encodeURIComponent(id)}/schedule`;
  const planningDates = schedule.from > today ? { from: schedule.from, to: schedule.to } : {};
  const shortDate = (date: string) => formatDate(date, { day: "numeric", month: "short" }, locale);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/contacts" className="text-sm font-medium text-brand-700 hover:underline">{messages.contacts.event.back}</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight">{t.heading(schedule.name)}</h1>
          {schedule.group && <p className="mt-1 text-sm text-slate-600">{schedule.group}</p>}
        </div>
        <Link href={{ pathname: "/contacts/plan", query: { find: "1", person: id, ...planningDates } }} className="btn-primary">{t.findTime}</Link>
      </header>
      <section className="card overflow-hidden" aria-labelledby="week-heading">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="week-heading" className="font-semibold">{shortDate(schedule.from)} – {formatDate(schedule.to, { day: "numeric", month: "short", year: "numeric" }, locale)}</h2>
            <p className="text-xs text-slate-500">{t.campusTime}</p>
          </div>
          <nav aria-label={t.weeks} className="flex items-center gap-1">
            <Link href={`${path}?week=${addDays(schedule.from, -7)}`} aria-label={t.previousWeek} className="btn-ghost">{t.previous}</Link>
            <Link href={path} className="btn-secondary">{t.thisWeek}</Link>
            <Link href={`${path}?week=${addDays(schedule.from, 7)}`} aria-label={t.nextWeek} className="btn-ghost">{t.next}</Link>
          </nav>
        </header>
        {schedule.events.length === 0 ? <p className="p-5 text-sm text-slate-600">{t.noEventsWeek}</p> :
          Array.from({ length: 7 }, (_, i) => addDays(schedule.from, i)).map((date) => {
            const events = schedule.events.filter((event) => event.date === date);
            return (
              <section key={date} className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[8.5rem_1fr]">
                <h3 className={`text-sm font-semibold ${date === today ? "text-brand-700" : "text-slate-700"}`}>
                  <time dateTime={date}>{capitalize(formatDate(date, { weekday: "short", day: "numeric", month: "short" }, locale))}</time>
                  {date === today && <span className="ml-1 text-xs font-normal">{messages.common.time.today}</span>}
                </h3>
                {events.length === 0 ? <p className="text-sm text-slate-500">{t.noEvents}</p> :
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
                              <span>{kindLabel(event.kind, locale)}{event.room && ` · ${event.room}`}</span>
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
