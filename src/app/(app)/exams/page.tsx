import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { exams, sources } from "@/db/schema";
import Link from "next/link";
import { ExamCard } from "@/components/ExamCard";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf } from "@/lib/catalog";
import { examReminders } from "@/lib/reminders";
import { examsForUser, placeResolver } from "@/lib/schedule";
import { formatDate, formatMinutes, nowLocal } from "@/lib/time";

export const metadata = { title: "Exams" };

type Exam = typeof exams.$inferSelect;

export default async function ExamsPage({ searchParams }: PageProps<"/exams">) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const db = getDb();
  const faculty = facultyOf(user.facultyId);
  const place = placeResolver(user.facultyId);
  const today = nowLocal().date;

  const mine = examsForUser(user);
  const upcoming = examReminders(user);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const all = user.facultyId
    ? db.select().from(exams).where(eq(exams.facultyId, user.facultyId)).orderBy(asc(exams.date), asc(exams.startMin)).all()
    : [];
  const found = q ? all.filter((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""} ${x.teacher ?? ""} ${x.audience ?? ""} ${x.room ?? ""}`).includes(fold(q))) : [];
  const documents = user.facultyId
    ? db.select().from(sources).where(and(eq(sources.facultyId, user.facultyId), eq(sources.kind, "exams"))).all()
    : [];

  const table = (list: Exam[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Time</th><th className="px-4 py-2 font-medium">Course</th><th className="px-4 py-2 font-medium">Where</th><th className="px-4 py-2 font-medium">For</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((x) => {
            const p = place(x.room);
            return (
              <tr key={x.id} className={x.date < today ? "text-slate-400" : ""}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium">{formatDate(x.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatMinutes(x.startMin)}–{formatMinutes(x.endMin)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{x.courseName}</span>
                  {x.courseAbbr && x.courseAbbr !== x.courseName && <span className="ml-1.5 text-xs text-slate-500">{x.courseAbbr}</span>}
                  {x.teacher && <span className="block text-xs text-slate-500">{x.teacher}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{x.room ?? "—"}</span>
                  {p && <span className="block text-xs text-slate-500">{p.name}</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{x.audience}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exams</h1>
        <p className="mt-1 text-sm text-slate-600">
          Exam bookings published by {faculty?.shortName ?? "your faculty"} for your specialization and year. They also appear in your calendar.
        </p>
      </div>

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">⏳ Coming up</h2>
            <p className="text-xs text-slate-500">
              🔔 Turn on reminders from the bell at the top, or{" "}
              <Link href="/settings" className="font-medium text-brand-600 hover:underline">export to Google Calendar</Link> for alerts on your phone.
            </p>
          </div>
          {upcoming.map((e) => (
            <ExamCard key={e.id} exam={e} />
          ))}
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Your exams</h2>
        {mine.length ? (
          table(mine)
        ) : (
          <p className="px-4 py-6 text-sm text-slate-600">
            {all.length
              ? "No exam is booked for your specialization and year yet. Faculties fill in the session calendar as the exam period approaches — search below to see what has been published so far."
              : "No exam schedule has been imported for your faculty. It either has not been published yet or is in a format that cannot be read automatically."}
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold">Search all exams{faculty?.shortName ? ` at ${faculty.shortName}` : ""}</h2>
          <form className="ml-auto flex gap-2">
            <input name="q" defaultValue={q} className="field w-56" placeholder="Course, teacher, room…" aria-label="Search exams" />
            <button className="btn-secondary">Search</button>
          </form>
        </div>
        {q ? (
          found.length ? table(found) : <p className="px-4 py-6 text-sm text-slate-600">Nothing matches “{q}”.</p>
        ) : (
          <p className="px-4 py-6 text-sm text-slate-600">{all.length} exam booking(s) imported. Search by course name or acronym, teacher or room.</p>
        )}
      </section>

      {documents.length > 0 && (
        <p className="text-xs text-slate-500">
          Source:{" "}
          {documents.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <a className="underline hover:text-brand-600" href={d.url} target="_blank" rel="noreferrer">{d.label}</a>
            </span>
          ))}
          {documents[0].lastFetchedAt ? ` · last imported ${formatDate(documents[0].lastFetchedAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}` : ""}
        </p>
      )}
    </div>
  );
}
