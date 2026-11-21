import Link from "next/link";
import { attendanceRecords, seriesDetails, summarizeAttendance, type SeriesDetails, type SeriesTally, type Tally } from "@/lib/attendance";
import { DATE_LOCALE, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { kindLabel, kindStyle } from "@/lib/kinds";
import { dayName, formatDate, formatMinutes } from "@/lib/time";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.attendance.title };
}

const rateText = (tally: Tally, locale: Locale) =>
  tally.rate === null ? "—" : new Intl.NumberFormat(DATE_LOCALE[locale], { style: "percent" }).format(tally.rate / 100);

function SeriesCard({ series, details, t, locale }: { series: SeriesTally; details: SeriesDetails; t: Messages["attendance"]; locale: Locale }) {
  const style = kindStyle(details.kind);
  const kind = kindLabel(details.kind, locale);
  const f = t.fields;
  const when = `${dayName(series.weekday, locale)} ${formatMinutes(series.startMin)}–${formatMinutes(series.endMin)}`;
  // [label, value, emphasised]
  const rows: Array<[string, React.ReactNode, boolean?]> = [
    [details.kind === "personal" ? f.event : f.course, details.title, true],
    [f.abbr, details.abbr && details.abbr !== details.title ? details.abbr : null],
    [f.type, kind],
    [f.date, details.examDates.map((d) => formatDate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, locale)).join(" / ")],
    [f.when, details.examDates.length ? `${formatMinutes(series.startMin)}–${formatMinutes(series.endMin)}` : when],
    [f.weeks, details.weeks],
    [details.kind === "personal" ? f.location : f.room, details.room, details.kind !== "personal"],
    [f.building, details.place ? `${details.place.name}${details.place.address ? `, ${details.place.address}` : ""}` : null],
    [f.teacher, details.teacher],
    [f.audience, details.audience],
    [f.note, details.note],
  ];
  return (
    <section className="card flex flex-col overflow-hidden">
      <header className="relative border-b border-slate-200 py-3 pl-5 pr-4">
        <span className={`absolute inset-y-0 left-0 w-1 ${style.dot}`} aria-hidden />
        <h2 className="font-semibold leading-snug text-slate-900">
          {details.title}
          {details.abbr && details.abbr !== details.title && <span className="ml-1.5 text-xs font-medium text-slate-500">{details.abbr}</span>}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {kind}
          </span>
          <span>{when}</span>
        </p>
      </header>

      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1.5 border-b border-slate-100 px-4 py-3 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value, strong]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className={strong ? "font-medium text-slate-900" : "text-slate-800"}>{value}</dd>
            </div>
          ))}
      </dl>

      <dl className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t.attended}</dt>
          <dd className="text-xl font-semibold tabular-nums text-emerald-700">{series.attended}</dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t.missed}</dt>
          <dd className="text-xl font-semibold tabular-nums text-red-700">{series.missed}</dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t.rate}</dt>
          <dd className="text-xl font-semibold tabular-nums text-brand-700">{rateText(series, locale)}</dd>
        </div>
      </dl>
      <div className="h-1.5 bg-red-100" aria-hidden>
        <div className="h-full bg-emerald-500" style={{ width: `${series.rate ?? 0}%` }} />
      </div>

      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm" aria-label={t.datesFor(series.title)}>
        {series.records.map((r) => {
          const attended = r.status === "attended";
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-medium text-slate-800">{formatDate(r.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, locale)}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${attended ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
              >
                {attended ? t.markAttended : t.markMissed}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function AttendancePage() {
  const user = await requireOnboardedUser();
  const t = (await getT()).attendance;
  const locale = await getLocale();
  const summary = summarizeAttendance(attendanceRecords(user.id));
  const details = seriesDetails(user, summary.series, locale);
  const count = new Intl.NumberFormat(DATE_LOCALE[locale]);

  const stats: Array<{ label: string; value: string; tone: string }> = [
    { label: t.attended, value: count.format(summary.attended), tone: "text-emerald-700" },
    { label: t.missed, value: count.format(summary.missed), tone: "text-red-700" },
    { label: t.attendanceRate, value: rateText(summary, locale), tone: "text-brand-700" },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.intro}</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label={t.overall}>
        {stats.map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </section>

      {summary.series.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {summary.series.map((s) => (
            <SeriesCard key={s.key} series={s} details={details.get(s.key)!} t={t} locale={locale} />
          ))}
        </div>
      ) : (
        <p className="card px-4 py-6 text-sm text-slate-600">
          {t.emptyBefore}
          <Link href="/" className="font-medium text-brand-700 underline">{t.emptyLink}</Link>
          {t.emptyAfter}
        </p>
      )}
    </div>
  );
}
