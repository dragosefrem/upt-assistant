import Link from "next/link";
import { attendanceRecords, seriesDetails, summarizeAttendance, type SeriesDetails, type SeriesTally, type Tally } from "@/lib/attendance";
import { requireOnboardedUser } from "@/lib/auth";
import { kindStyle } from "@/lib/kinds";
import { DAY_NAMES, formatDate, formatMinutes } from "@/lib/time";

export const metadata = { title: "Attendance" };

const rateText = (t: Tally) => (t.rate === null ? "—" : `${t.rate}%`);

function SeriesCard({ series, details }: { series: SeriesTally; details: SeriesDetails }) {
  const style = kindStyle(details.kind);
  const when = `${DAY_NAMES[series.weekday]} ${formatMinutes(series.startMin)}–${formatMinutes(series.endMin)}`;
  const rows: Array<[string, React.ReactNode]> = [
    [details.kind === "personal" ? "Event" : "Course", details.title],
    ["Abbreviation", details.abbr && details.abbr !== details.title ? details.abbr : null],
    ["Type", style.label],
    ["Date", details.examDates.map((d) => formatDate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })).join(" / ")],
    ["When", details.examDates.length ? `${formatMinutes(series.startMin)}–${formatMinutes(series.endMin)}` : when],
    ["Weeks", details.weeks],
    [details.kind === "personal" ? "Location" : "Room", details.room],
    ["Building", details.place ? `${details.place.name}${details.place.address ? `, ${details.place.address}` : ""}` : null],
    ["Teacher", details.teacher],
    ["Audience", details.audience],
    ["Note", details.note],
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
            {style.label}
          </span>
          <span>{when}</span>
        </p>
      </header>

      <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 border-b border-slate-100 px-4 py-3 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd className={label === "Course" || label === "Event" || label === "Room" ? "font-medium text-slate-900" : "text-slate-800"}>{value}</dd>
            </div>
          ))}
      </dl>

      <dl className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Attended</dt>
          <dd className="text-xl font-semibold tabular-nums text-emerald-700">{series.attended}</dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Missed</dt>
          <dd className="text-xl font-semibold tabular-nums text-red-700">{series.missed}</dd>
        </div>
        <div className="px-2 py-2.5">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Rate</dt>
          <dd className="text-xl font-semibold tabular-nums text-brand-700">{rateText(series)}</dd>
        </div>
      </dl>
      <div className="h-1.5 bg-red-100" aria-hidden>
        <div className="h-full bg-emerald-500" style={{ width: `${series.rate ?? 0}%` }} />
      </div>

      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto text-sm" aria-label={`Dates for ${series.title}`}>
        {series.records.map((r) => {
          const attended = r.status === "attended";
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="font-medium text-slate-800">{formatDate(r.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${attended ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
              >
                {attended ? "✓ Attended" : "✗ Missed"}
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
  const summary = summarizeAttendance(attendanceRecords(user.id));
  const details = seriesDetails(user, summary.series);

  const stats: Array<{ label: string; value: string; tone: string }> = [
    { label: "Attended", value: String(summary.attended), tone: "text-emerald-700" },
    { label: "Missed", value: String(summary.missed), tone: "text-red-700" },
    { label: "Attendance rate", value: rateText(summary), tone: "text-brand-700" },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every recurring class, exam and personal event you marked, each with its own statistics. Open an event in the calendar to mark it — each date is recorded on its own.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Overall summary">
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
            <SeriesCard key={s.key} series={s} details={details.get(s.key)!} />
          ))}
        </div>
      ) : (
        <p className="card px-4 py-6 text-sm text-slate-600">
          Nothing marked yet. Open a class in the <Link href="/" className="font-medium text-brand-700 underline">calendar</Link> and choose Attended or Missed.
        </p>
      )}
    </div>
  );
}
