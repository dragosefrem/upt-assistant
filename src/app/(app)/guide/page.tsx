import Link from "next/link";
import { AskPoli } from "@/components/AskPoli";
import { GlossarySearch } from "@/components/GlossarySearch";
import { GuideChecklist } from "@/components/GuideChecklist";
import { Mascot } from "@/components/Mascot";
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
  const overview = semester ? semesterOverview(semester, today) : null;
  const group = describeGroup(user.groupId, locale);
  const buildings = studentBuildings(user);
  const published = examsForUser(user, today).length;
  const date = (d: string, year = false) => formatDate(d, { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) }, locale);
  // Which of the four levels the student's own group label fills in.
  const mine = group ? [messages.common.time.year(group.group.year), group.group.series, group.group.name.split(".")[0], group.group.name.includes(".") ? group.group.name : ""] : [];

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
    ["timetable", t.nav.timetable],
    ["glossary", t.nav.glossary],
    ["buildings", t.nav.buildings],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="card relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-4">
          <div className="hidden rounded-2xl bg-white/15 p-2 sm:block">
            <Mascot size={64} wave />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.heading}</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/90 sm:text-base">{t.intro}</p>
          </div>
        </div>
        <nav aria-label={t.title} className="relative mt-4 flex flex-wrap gap-2">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-brand-700 shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <section id="first-week" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">✅ {t.firstWeek.title}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">{t.firstWeek.intro}</p>
        <GuideChecklist />
      </section>

      <section id="semester" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">🗓️ {t.semester.title}</h2>
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

      <section id="timetable" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">🔎 {t.timetable.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.timetable.intro}</p>
        <p className="mt-3 rounded-2xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-900">
          {group ? t.timetable.yourPlace(group.spec.name, group.group.year, group.label) : t.timetable.noGroup}
        </p>

        <ol className="mt-4 space-y-2">
          {t.timetable.levels.map((level, i) => (
            <li key={level.name} className="flex items-stretch gap-3" style={{ paddingLeft: `${i * 0.9}rem` }}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-sm font-semibold text-slate-900" lang="ro">{level.name}</p>
                {mine[i] && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{t.timetable.you}: {mine[i]}</span>
                )}
                <p className="w-full text-sm text-slate-600">{level.who} — <span className="font-medium text-slate-800">{level.what}</span></p>
              </div>
            </li>
          ))}
        </ol>

        <h3 className="mt-6 text-sm font-semibold text-slate-900">{t.timetable.kindsTitle}</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {t.timetable.kinds.map((k, i) => (
            <li key={k.code} className="flex gap-3 rounded-2xl border border-slate-200 p-3">
              <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${["bg-brand-50 text-brand-700", "bg-emerald-50 text-emerald-700", "bg-amber-50 text-amber-800", "bg-fuchsia-50 text-fuchsia-700"][i]}`}>{k.code}</span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{k.name}</p>
                <p className="text-sm text-slate-600">{k.what}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t.timetable.weeksTitle}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.timetable.weeks}</p>
            {overview?.week != null && (
              <p className="mt-2 text-sm font-medium text-brand-800">{t.timetable.weeksNow(overview.week, overview.parity === "odd" ? t.semester.odd : t.semester.even)}</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t.timetable.roomsTitle}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.timetable.rooms}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{t.timetable.askTitle}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {t.timetable.questions.map((q) => (
              <AskPoli key={q} question={q} className="btn-secondary bg-white px-3 py-1.5 text-xs" />
            ))}
          </div>
        </div>
      </section>

      <section id="glossary" className="card scroll-mt-20 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">📖 {t.glossary.title}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">{t.glossary.intro}</p>
        <GlossarySearch />
      </section>

      <section id="buildings" className="card scroll-mt-20 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">🏛️ {t.buildings.title}</h2>
          <Link href="/campus" className="btn-secondary ml-auto px-3 py-1.5 text-xs">🧭 {t.buildings.open}</Link>
        </div>
        <p className="mt-1 text-sm text-slate-600">{t.buildings.intro}</p>
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
    </div>
  );
}
