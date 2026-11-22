import Link from "next/link";
import { GlossarySearch } from "@/components/GlossarySearch";
import { GuideChecklist } from "@/components/GuideChecklist";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { studentBuildings } from "@/lib/campus-buildings";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { currentSemester, describeGroup, examsForUser } from "@/lib/schedule";
import { semesterOverview } from "@/lib/semester-overview";
import { daysBetween, formatDate, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  return { title: (await getT()).guide.title };
}

/** The freshman guide: what to do first, how the semester and the timetable work, and the vocabulary. */
export default async function GuidePage() {
  const user = await requireOnboardedUser();
  const [messages, locale] = await Promise.all([getT(), getLocale()]);
  const t = messages.guide;
  const today = nowLocal().date;
  const semester = currentSemester();
  const overview = semester ? semesterOverview(semester, today, locale) : null;
  const group = describeGroup(user.groupId, locale);
  const buildings = studentBuildings(user);
  // A distance-learning exam is published as three sittings: one exam, not three.
  const published = new Set(examsForUser(user, today).map((x) => x.courseName)).size;
  const date = (d: string, year = false) => formatDate(d, { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) }, locale);

  // The semester as one bar: classes, holidays and the session, in proportion.
  const segments = overview
    ? [
        ...overview.teaching.flatMap((run, i) => [
          { kind: "teaching" as const, from: run.from, to: run.to },
          ...(overview.holidays[i] ? [{ kind: "holiday" as const, from: overview.holidays[i].from, to: overview.holidays[i].to }] : []),
        ]),
        ...(overview.session ? [{ kind: "session" as const, from: overview.session.from, to: overview.session.to }] : []),
      ]
    : [];
  const first = segments[0]?.from;
  const last = segments.at(-1)?.to;
  const span = first && last ? daysBetween(first, last) + 1 : 1;
  const marker = first && last && today >= first && today <= last ? ((daysBetween(first, today) + 0.5) / span) * 100 : null;
  const segmentStyle = { teaching: "bg-brand-500", holiday: "bg-amber-300", session: "bg-red-400" };

  const sections = [
    ["first-week", t.nav.firstWeek],
    ["semester", t.nav.semester],
    ["buildings", t.buildings.title],
    ["glossary", t.glossary.title],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="page-heading">
        <h1>{t.heading}</h1>
        <nav aria-label={t.title} className="mt-4 flex flex-wrap gap-2">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="btn-secondary text-xs">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <section id="first-week" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">{t.firstWeek.title}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">{t.firstWeek.intro}</p>
        <GuideChecklist />
      </section>

      <section id="semester" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">{t.semester.title}</h2>
        {!overview ? (
          <p className="mt-2 text-sm text-slate-600">{t.semester.none}</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">{t.semester.name(overview.number, overview.academicYear)}</p>
            <p className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
              <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{t.semester.now}</span>
              {overview.state === "teaching" && overview.week !== null
                ? t.semester.teachingWeek(overview.week, overview.totalWeeks, overview.parity === "odd" ? t.semester.odd : t.semester.even)
                : overview.state === "holiday" && overview.resumes
                  ? t.semester.holidayNow(date(overview.resumes))
                  : overview.state === "before" && overview.resumes
                    ? t.semester.beforeStart(date(overview.resumes))
                    : overview.state === "session"
                      ? t.semester.sessionNow
                      : t.semester.over}
              {overview.state === "teaching" && overview.weeksLeft > 0 && <span className="font-normal text-brand-700">· {t.semester.weeksLeft(overview.weeksLeft)}</span>}
            </p>

            <div className="relative mt-5" aria-hidden>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {segments.map((s) => (
                  <div key={s.from} className={segmentStyle[s.kind]} style={{ width: `${((daysBetween(s.from, s.to) + 1) / span) * 100}%` }} />
                ))}
              </div>
              {marker !== null && (
                <div className="absolute -top-1.5 h-6 w-0.5 rounded bg-slate-900" style={{ left: `${marker}%` }}>
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t.semester.now}</span>
                </div>
              )}
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="flex items-center gap-2 font-semibold text-slate-900"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-brand-500" />{t.semester.teaching}</dt>
                {overview.teaching.map((run) => (
                  <dd key={run.from} className="mt-1 text-slate-600">{t.semester.teachingRange(date(run.from), date(run.to), run.weeks)}</dd>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="flex items-center gap-2 font-semibold text-slate-900"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-300" />{t.semester.holiday}</dt>
                {overview.holidays.length ? overview.holidays.map((h) => (
                  <dd key={h.from} className="mt-1 text-slate-600">{t.semester.holidayRange(date(h.from), date(h.to, true))}</dd>
                )) : <dd className="mt-1 text-slate-600">—</dd>}
                {/* A free Monday changes a first-year's week as much as a break does. */}
                {overview.daysOff.filter((d) => d.date >= today).length > 0 && (
                  <dd className="mt-2 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-600">
                    <span className="font-medium text-slate-800">{t.semester.daysOff}</span>{" "}
                    {overview.daysOff.filter((d) => d.date >= today)
                      .map((d) => `${formatDate(d.date, { weekday: "long", day: "numeric", month: "long" }, locale)} (${d.name})`).join("; ")}
                  </dd>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="flex items-center gap-2 font-semibold text-slate-900"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red-400" />{t.semester.session}</dt>
                <dd className="mt-1 text-slate-600">{overview.session ? t.semester.sessionRange(date(overview.session.from), date(overview.session.to, true)) : "—"}</dd>
                <dd className="mt-1 text-xs text-slate-500">
                  {published ? t.semester.examsPublished(published) : t.semester.examsNotPublished}{" "}
                  <Link href="/exams" className="font-medium text-brand-700 hover:underline">{t.semester.seeExams}</Link>
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section id="buildings" className="card scroll-mt-20 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{t.buildings.title}</h2>
          <Link href="/campus" className="btn-secondary ml-auto px-3 py-1.5 text-xs">{t.buildings.open}</Link>
        </div>
        {buildings.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {buildings.map((b) => (
              <li key={b.name} className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">{b.name}</p>
                {b.address && <p className="text-sm text-slate-600">{b.address}{b.approximate ? ` · ${t.buildings.approximate}` : ""}</p>}
                <p className="mt-2 text-xs text-slate-500">{b.courses.join(" · ")}</p>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {b.rooms.map((room) => (
                    <Link key={room} href={campusJourneyHref({ to: room, building: b.name })} title={t.buildings.walkthrough} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:border-brand-500">
                      {room}
                    </Link>
                  ))}
                </p>
                <a className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`} target="_blank" rel="noreferrer">
                  📍 {t.buildings.map}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">{t.buildings.none}</p>
        )}
      </section>

      <section id="glossary" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 id="timetable" className="scroll-mt-20 text-lg font-semibold text-slate-900">{t.glossary.title}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">
          {group
            ? t.glossary.yourPlace(group.spec.name, group.group.year, group.label)
            : <Link href="/settings" className="font-medium text-brand-700 hover:underline">{t.glossary.noGroup}</Link>}
        </p>
        <GlossarySearch />
      </section>
    </div>
  );
}
