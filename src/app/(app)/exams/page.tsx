import { Search } from "lucide-react";
import { facultyDocuments } from "@/lib/faculty-documents";
import { importDiagnostic } from "@/i18n/messages/import-diagnostics";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { exams } from "@/db/schema";
import { ExamCard } from "@/components/ExamCard";
import { StudyPlanCard } from "@/components/StudyPlanCard";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf } from "@/lib/catalog";
import { examAudience, examSitting } from "@/lib/exam-audience";
import { examReminders } from "@/lib/reminders";
import { placeResolver } from "@/lib/schedule";
import { studyBlocks, upcomingExams } from "@/lib/study-plan";
import { capitalize, formatDate, formatTimeSlot, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.exams.page.title };
}

type Exam = typeof exams.$inferSelect;

/** The student's exams with Poli's tips, and a search across the faculty's exam list. */
export default async function ExamsPage({ searchParams }: PageProps<"/exams">) {
  const user = await requireOnboardedUser();
  const messages = await getT();
  const t = messages.exams.page;
  const locale = await getLocale();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const db = getDb();
  const faculty = facultyOf(user.facultyId);
  const place = placeResolver(user.facultyId);
  const today = nowLocal().date;

  // Every upcoming exam of the session, not just the next 30 days.
  const mine = examReminders(user, new Date(), 366, locale);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const all = user.facultyId
    ? db.select().from(exams).where(eq(exams.facultyId, user.facultyId)).orderBy(asc(exams.date), asc(exams.startMin)).all()
    : [];
  const found = q ? all.filter((x) => fold(`${x.courseName} ${x.courseAbbr ?? ""} ${x.teacher ?? ""} ${x.audience ?? ""} ${x.room ?? ""}`).includes(fold(q))) : [];
  const documents = facultyDocuments(user.facultyId, "exams");

  const examCount = upcomingExams(user).length;
  const savedBlocks = studyBlocks(user.id).length;

  const table = (list: Exam[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">{t.columns.date}</th>
            <th className="px-4 py-2 font-medium">{t.columns.time}</th>
            <th className="px-4 py-2 font-medium">{t.columns.course}</th>
            <th className="px-4 py-2 font-medium">{t.columns.where}</th>
            <th className="hidden px-4 py-2 font-medium sm:table-cell">{t.columns.audience}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((x) => {
            const p = place(x.room);
            // A distance-learning exam is published per programme and year, in three sittings.
            const audience = examSitting(x.audience)
                    ? [x.session?.split(" · ")[0], x.year ? messages.common.time.year(x.year) : null, examAudience(x.audience, locale)].filter(Boolean).join(" · ")
                    : examAudience(x.audience, locale);
            return (
              <tr key={x.id} className={x.date < today ? "text-slate-400" : ""}>
                <td className="whitespace-nowrap px-4 py-2.5 font-medium">{capitalize(formatDate(x.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }, locale))}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{formatTimeSlot(x.startMin, x.endMin)}</td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{x.courseName}</span>
                  {x.courseAbbr && x.courseAbbr !== x.courseName && <span className="ml-1.5 text-xs text-slate-500">{x.courseAbbr}</span>}
                  {x.teacher && <span className="block text-xs text-slate-500">{x.teacher}</span>}
                  {/* On a phone the last column is off the screen: who the exam is for is said here. */}
                  {audience && <span className="mt-0.5 block text-xs text-slate-600 sm:hidden">{t.columns.audience}: {audience}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{x.room ?? "—"}</span>
                  {p && <span className="block text-xs text-slate-500">{p.name}</span>}
                </td>
                <td className="hidden px-4 py-2.5 text-xs text-slate-600 sm:table-cell">{audience}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="page-heading">
        <h1>{t.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{t.intro(faculty?.shortName ?? null)}</p>
      </div>

      {mine.length ? (
        mine.map((e) => <ExamCard key={e.id} exam={e} />)
      ) : (
        <p className="card px-4 py-6 text-sm text-slate-600">
          {all.length ? t.noneBooked : t.noneImported}
        </p>
      )}

      {(examCount > 0 || savedBlocks > 0) && <StudyPlanCard examCount={examCount} savedBlocks={savedBlocks} />}

      {(all.length > 0 || q) && <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Search size={16} aria-hidden />{t.searchHeading(faculty?.shortName ?? null)}</h2>
          <form className="flex w-full min-w-0 gap-2 sm:ml-auto sm:w-auto">
            <input name="q" defaultValue={q} className="field w-56 min-w-0" placeholder={t.searchPlaceholder} aria-label={t.searchLabel} />
            <button className="btn-secondary">{messages.common.actions.search}</button>
          </form>
        </div>
        {q && (found.length ? table(found) : <p className="px-4 py-4 text-sm text-slate-600">{t.noMatch(q)}</p>)}
      </section>}

      {documents.length > 0 && (
        <p className="text-xs text-slate-500">
          {t.source}{" "}
          {documents.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <a className="underline hover:text-brand-600" href={d.url} target="_blank" rel="noreferrer">{d.label}</a>
              {d.status === "partial" && d.message && <span> · {importDiagnostic(d.message, locale)}</span>}
            </span>
          ))}
          {documents[0].lastFetchedAt ? ` · ${t.lastImported(formatDate(documents[0].lastFetchedAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" }, locale))}` : ""}
        </p>
      )}
    </div>
  );
}
