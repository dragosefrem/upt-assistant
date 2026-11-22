import { asc, gte } from "drizzle-orm";
import { ArrowLeft, CalendarDays, CheckCircle2, Plus, Users } from "lucide-react";
import Link from "next/link";
import { CancelSponsoredEvent } from "@/components/CancelSponsoredEvent";
import { getDb } from "@/db";
import { faculties, sponsoredEvents } from "@/db/schema";
import { getLocale, getT } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth";
import { formatDate, formatTimeSlot, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  return { title: (await getT()).sponsored.title };
}

export default async function SponsoredEventsPage({ searchParams }: PageProps<"/admin/sponsored-events">) {
  await requireAdmin();
  const { sponsored: t, admin } = await getT();
  const locale = await getLocale();
  const { published } = await searchParams;
  const now = nowLocal();
  const db = getDb();
  const events = db.select().from(sponsoredEvents).where(gte(sponsoredEvents.date, now.date))
    .orderBy(asc(sponsoredEvents.date), asc(sponsoredEvents.startMin), asc(sponsoredEvents.title)).all()
    .filter((e) => e.date > now.date || e.endMin > now.minutes);
  const names = new Map(db.select().from(faculties).all().map((f) => [f.id, f.shortName || f.name]));
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft size={16} aria-hidden />{admin.title}
      </Link>
      <header className="page-heading flex flex-wrap items-end justify-between gap-4">
        <div><h1>{t.title}</h1><p className="mt-2 text-sm text-slate-600">{t.manageIntro}</p></div>
        <Link href="/admin/sponsored-events/new" className="btn-primary"><Plus size={17} aria-hidden />{t.create}</Link>
      </header>
      {events.some((e) => e.id === published && !e.cancelled) && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 size={17} aria-hidden />{t.published}
        </p>
      )}
      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-5 py-4 text-base font-semibold">{t.upcoming}</h2>
        {events.length ? <ul className="divide-y divide-slate-100">
          {events.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1 basis-60 space-y-1">
              <p className="text-sm font-medium text-cyan-800">{formatDate(e.date, { day: "numeric", month: "short", year: "numeric" }, locale)} · {formatTimeSlot(e.startMin, e.endMin)}</p>
              <h3 className="text-lg font-semibold wrap-anywhere">{e.title}</h3>
              <p className="text-sm text-slate-600 wrap-anywhere">{t.by(e.sponsor)}{e.location && ` · ${e.location}`}</p>
              <p className="flex items-start gap-1.5 pt-1 text-xs text-slate-600">
                <Users size={15} className="shrink-0" aria-hidden />
                {e.facultyIds.length ? e.facultyIds.map((id) => names.get(id) ?? `#${id}`).join(", ") : t.allFaculties}
                {" · "}{e.years.length ? e.years.map(t.year).join(", ") : t.allYears}
              </p>
            </div>
            {e.cancelled ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{t.cancelled}</span>
              : <CancelSponsoredEvent id={e.id} title={e.title} />}
          </li>)}
        </ul> : <div className="grid justify-items-center gap-3 px-5 py-12 text-center text-sm text-slate-600">
          <CalendarDays size={26} aria-hidden className="text-cyan-700" />{t.empty}
        </div>}
      </section>
    </div>
  );
}
