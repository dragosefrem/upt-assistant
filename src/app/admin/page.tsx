import { asc, desc, eq, sql } from "drizzle-orm";
import { ScrapePanel } from "@/components/ScrapePanel";
import { getDb } from "@/db";
import { courses, faculties, scrapeRuns, semesters, sources, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { claudeConfigured } from "@/lib/assistant/claude";
import { googleConfigured } from "@/lib/google";
import { setCourseOptionalAction, setCurrentSemesterAction, setUserRoleAction } from "./actions";

export const metadata = { title: "Admin" };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const db = getDb();

  const facultyRows = db.select().from(faculties).orderBy(asc(faculties.name)).all();
  const overview = db.all<{
    id: number;
    name: string;
    short_name: string | null;
    schedule_url: string | null;
    programmes: number;
    groups: number;
    activities: number;
    exams: number;
    imported: number;
    unreadable: number;
    failed: number;
  }>(sql`
    SELECT f.id, f.name, f.short_name, f.schedule_url,
      (SELECT count(*) FROM specializations s WHERE s.faculty_id = f.id) AS programmes,
      (SELECT count(*) FROM groups g JOIN specializations s ON s.id = g.specialization_id WHERE s.faculty_id = f.id) AS groups,
      (SELECT count(*) FROM entries e JOIN courses c ON c.id = e.course_id WHERE c.faculty_id = f.id) AS activities,
      (SELECT count(*) FROM exams x WHERE x.faculty_id = f.id) AS exams,
      (SELECT count(*) FROM sources o WHERE o.faculty_id = f.id AND o.status = 'imported') AS imported,
      (SELECT count(*) FROM sources o WHERE o.faculty_id = f.id AND o.status = 'unsupported') AS unreadable,
      (SELECT count(*) FROM sources o WHERE o.faculty_id = f.id AND o.status = 'failed') AS failed
    FROM faculties f ORDER BY f.name`);
  const runs = db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.id)).limit(10).all();
  const semesterRows = db.select().from(semesters).orderBy(asc(semesters.startDate)).all();
  const userRows = db.select().from(users).orderBy(asc(users.createdAt)).all();

  const facultyFilter = Number(params.faculty) || facultyRows.find((f) => overview.find((o) => o.id === f.id)?.activities)?.id || 0;
  const yearFilter = Number(params.year) || 3;
  const courseRows = facultyFilter
    ? db
        .select()
        .from(courses)
        .where(sql`${courses.facultyId} = ${facultyFilter} AND ${courses.year} = ${yearFilter} AND EXISTS (SELECT 1 FROM entries e WHERE e.course_id = ${courses.id})`)
        .orderBy(asc(courses.name))
        .all()
    : [];
  const sourceRows = db
    .select({ source: sources, faculty: faculties.shortName })
    .from(sources)
    .innerJoin(faculties, eq(faculties.id, sources.facultyId))
    .where(sql`${sources.status} IN ('imported', 'failed')`)
    .orderBy(asc(faculties.shortName), asc(sources.kind))
    .all();

  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-slate-600">Keep the timetable database in step with what the faculties publish on upt.ro.</p>
      </div>

      <section className="card p-6">
        <h2 className="mb-4 text-base font-semibold">Scrape UPT</h2>
        <ScrapePanel faculties={facultyRows.map((f) => ({ id: f.id, label: f.shortName ?? f.name.replace(/^Facultatea de /, "") }))} initialRuns={runs} />
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">What is in the database</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className={th}>Faculty</th><th className={th}>Programmes</th><th className={th}>Groups</th><th className={th}>Activities</th>
                <th className={th}>Exams</th><th className={th}>Documents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.map((f) => (
                <tr key={f.id}>
                  <td className={td}>
                    <span className="font-medium">{f.short_name ?? "—"}</span>{" "}
                    {f.schedule_url ? (
                      <a className="text-slate-600 hover:underline" href={f.schedule_url} target="_blank" rel="noreferrer">{f.name.replace(/^Facultatea de /, "")}</a>
                    ) : (
                      <span className="text-slate-600">{f.name.replace(/^Facultatea de /, "")}</span>
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>{f.programmes}</td>
                  <td className={`${td} tabular-nums`}>{f.groups}</td>
                  <td className={`${td} tabular-nums`}>{f.activities}</td>
                  <td className={`${td} tabular-nums`}>{f.exams}</td>
                  <td className={`${td} text-xs`}>
                    {f.imported > 0 && <span className="mr-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{f.imported} imported</span>}
                    {f.unreadable > 0 && <span className="mr-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{f.unreadable} PDF/link only</span>}
                    {f.failed > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">{f.failed} failed</span>}
                    {!f.imported && !f.unreadable && !f.failed && <span className="text-slate-400">none found</span>}
                  </td>
                </tr>
              ))}
              {!overview.length && (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={6}>Empty. Run a scrape to import faculties, programmes and timetables.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Timetables published as Excel workbooks or Google Sheets are imported. Faculties that publish PDFs are listed as documents
          and linked for their students, but their classes are not in the calendar.
        </p>
      </section>

      {sourceRows.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Imported documents</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {sourceRows.map(({ source, faculty }) => (
              <li key={source.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="w-14 shrink-0 font-medium">{faculty}</span>
                <a className="min-w-0 flex-1 truncate text-brand-700 hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
                <span className="text-xs text-slate-500">{source.kind} · {source.message}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${source.status === "imported" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{source.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold">Optional courses</h2>
          <form className="ml-auto flex gap-2 text-sm">
            <select name="faculty" defaultValue={facultyFilter} className="field w-auto" aria-label="Faculty">
              {facultyRows.map((f) => (<option key={f.id} value={f.id}>{f.shortName ?? f.name}</option>))}
            </select>
            <select name="year" defaultValue={yearFilter} className="field w-auto" aria-label="Year">
              {[1, 2, 3, 4, 5, 6].map((y) => (<option key={y} value={y}>Year {y}</option>))}
            </select>
            <button className="btn-secondary">Show</button>
          </form>
        </div>
        <p className="px-4 pt-3 text-xs text-slate-500">
          Published timetables do not say which courses are elective. Students from year 3 up can untick any course; a course
          marked optional here starts unticked for everyone, in any year.
        </p>
        <ul className="grid gap-x-6 px-4 py-3 text-sm sm:grid-cols-2">
          {courseRows.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5">
              <span className="min-w-0 truncate">{c.name}{c.abbreviation && <span className="ml-1.5 text-xs text-slate-500">{c.abbreviation}</span>}</span>
              <form action={setCourseOptionalAction}>
                <input type="hidden" name="courseId" value={c.id} />
                <input type="hidden" name="isOptional" value={String(!c.isOptional)} />
                <button className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.isOptional ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} title="Click to change">
                  {c.isOptional ? "optional" : "mandatory"}
                </button>
              </form>
            </li>
          ))}
          {!courseRows.length && <li className="py-3 text-slate-500">No courses for this faculty and year.</li>}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-base font-semibold">Semester</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">The scraper imports documents for the current semester, and the calendar follows its teaching weeks.</p>
          <ul className="space-y-2 text-sm">
            {semesterRows.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <span>
                  <span className="font-medium">{s.academicYear}, semester {s.number}</span>
                  <span className="block text-xs text-slate-500">
                    {s.startDate} → {s.endDate} · {(JSON.parse(s.teachingWeeks) as string[]).length} teaching weeks
                    {s.examStart ? ` · exams ${s.examStart} → ${s.examEnd}` : ""}
                  </span>
                </span>
                {s.isCurrent ? (
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">current</span>
                ) : (
                  <form action={setCurrentSemesterAction}>
                    <input type="hidden" name="semesterId" value={s.id} />
                    <button className="btn-secondary px-2.5 py-1 text-xs">Make current</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6">
          <h2 className="text-base font-semibold">Integrations</h2>
          <ul className="mt-3 space-y-3 text-sm">
            <li>
              <span className="font-medium">Assistant: </span>
              {claudeConfigured() ? (
                <span className="text-emerald-700">Claude connected</span>
              ) : (
                <span className="text-slate-600">built-in keyword assistant. Set <code className="rounded bg-slate-100 px-1">ANTHROPIC_API_KEY</code> to connect Claude.</span>
              )}
            </li>
            <li>
              <span className="font-medium">Google Calendar: </span>
              {googleConfigured() ? (
                <span className="text-emerald-700">direct export enabled</span>
              ) : (
                <span className="text-slate-600">
                  .ics only. Set <code className="rounded bg-slate-100 px-1">GOOGLE_CLIENT_ID</code> and <code className="rounded bg-slate-100 px-1">GOOGLE_CLIENT_SECRET</code> for direct export.
                </span>
              )}
            </li>
          </ul>
        </section>
      </div>

      <section className="card overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Accounts ({userRows.length})</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {userRows.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{u.name}</span> <span className="text-slate-500">{u.email}</span></span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.role === "admin" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{u.role}</span>
              {u.id !== admin.id && (
                <form action={setUserRoleAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="role" value={u.role === "admin" ? "student" : "admin"} />
                  <button className="btn-ghost px-2 py-1 text-xs">{u.role === "admin" ? "Make student" : "Make admin"}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
