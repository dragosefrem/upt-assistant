import { and, eq } from "drizzle-orm";
import { saveProfileAction } from "@/app/onboarding/actions";
import { CourseChoicesForm } from "@/components/CourseChoicesForm";
import { ExportPanel } from "@/components/ExportPanel";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ProfilePicker } from "@/components/ProfilePicker";
import { getDb } from "@/db";
import { sources, timetablePdfs } from "@/db/schema";
import { getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf, pickerData } from "@/lib/catalog";
import { googleConfigured } from "@/lib/google";
import { mailConfigured } from "@/lib/mail";
import { courseChoices, currentSemester } from "@/lib/schedule";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.settings.page.title };
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireOnboardedUser();
  const t = await getT();
  const s = t.settings;
  const params = await searchParams;
  const semester = currentSemester();
  const choices = semester ? courseChoices(user, semester) : [];
  const faculty = facultyOf(user.facultyId);
  const documents = user.facultyId && semester
    ? getDb().select({ id: sources.id, label: sources.label, url: sources.url, status: sources.status,
        format: sources.format, message: sources.message, pdfId: timetablePdfs.sourceId }).from(sources)
      .leftJoin(timetablePdfs, eq(timetablePdfs.sourceId, sources.id))
      .where(and(eq(sources.facultyId, user.facultyId), eq(sources.kind, "timetable"),
        eq(sources.academicYear, semester.academicYear), eq(sources.semester, semester.number))).all()
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{s.page.title}</h1>

      <section className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{s.language.title}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{s.language.hint}</p>
        </div>
        <LanguageSwitch />
      </section>

      <section className="card p-6">
        <h2 className="text-base font-semibold">{s.study.title}</h2>
        <p className="mb-5 mt-1 text-sm text-slate-600">{s.study.hint}</p>
        <ProfilePicker
          data={pickerData()}
          initial={{ facultyId: user.facultyId, specializationId: user.specializationId, year: user.year, groupId: user.groupId }}
          action={saveProfileAction}
          submitLabel={t.common.actions.save}
        />
      </section>

      <section id="courses" className="card scroll-mt-20 p-6">
        <h2 className="mb-4 text-base font-semibold">{s.courses.title}</h2>
        <CourseChoicesForm choices={choices} returnTo="/settings#courses" submitLabel={s.courses.save} />
      </section>

      <section id="export" className="card scroll-mt-20 p-6">
        <h2 className="mb-4 text-base font-semibold">{s.export.title}</h2>
        <ExportPanel
          mailConfigured={mailConfigured()}
          defaultEmail={user.exportEmail ?? user.email}
          googleConfigured={googleConfigured()}
          connected={!!user.googleRefreshToken}
          syncedAt={user.googleSyncedAt}
          feedPath={`/api/ics/${user.feedToken}.ics`}
          flash={typeof params.google === "string" ? params.google : null}
        />
      </section>

      {faculty && (
        <section className="card p-6">
          <h2 className="text-base font-semibold">{s.documents.title(faculty.shortName ?? faculty.name)}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">{s.documents.hint}</p>
          {documents.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a className="text-brand-700 hover:underline" href={d.pdfId ? `/api/timetables/${d.pdfId}` : d.url} target="_blank" rel="noreferrer">{d.label}</a>
                    {d.status === "partial" && <p className="text-xs text-amber-800">{d.message}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${d.status === "imported" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {d.status === "unsupported" ? d.format.toUpperCase() : (s.documents.status[d.status] ?? d.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">
              {s.documents.empty}
              {faculty.scheduleUrl && (
                <>
                  {" "}{s.documents.seeBefore}
                  <a className="text-brand-700 underline" href={faculty.scheduleUrl} target="_blank" rel="noreferrer">{s.documents.facultyPage}</a>
                  {s.documents.seeAfter}
                </>
              )}
            </p>
          )}
        </section>
      )}

      <p className="text-xs text-slate-500">{s.page.signedInAs(user.email, s.page.roles[user.role] ?? user.role)}</p>
    </div>
  );
}
