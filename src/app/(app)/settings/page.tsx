import { facultyDocuments } from "@/lib/faculty-documents";
import { importDiagnostic } from "@/i18n/messages/import-diagnostics";
import { saveProfileAction } from "@/app/onboarding/actions";
import { CourseChoicesForm } from "@/components/CourseChoicesForm";
import { ExportPanel } from "@/components/ExportPanel";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ProfilePicker } from "@/components/ProfilePicker";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf, pickerData } from "@/lib/catalog";
import { googleConfigured, googleSyncDelayed, googleSyncMode } from "@/lib/google";
import { kindLabel } from "@/lib/kinds";
import { mailConfigured } from "@/lib/mail";
import { courseChoices, currentSemester, hiddenClasses } from "@/lib/schedule";
import { dayName, formatMinutes } from "@/lib/time";
import { restoreHiddenClass } from "./actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.settings.page.title };
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireOnboardedUser();
  const t = await getT();
  const s = t.settings;
  const locale = await getLocale();
  const params = await searchParams;
  const semester = currentSemester();
  const choices = semester ? courseChoices(user, semester) : [];
  const hidden = hiddenClasses(user.id, semester?.id);
  const faculty = facultyOf(user.facultyId);
  const documents = facultyDocuments(user.facultyId, "timetable", semester);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="page-heading">{s.page.title}</h1>

      <nav aria-label={s.page.title} className="flex flex-wrap gap-2">
        {([["profile", s.study.title], ["courses", s.courses.title], ["export", s.export.title], ["language", s.language.title]] as const).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="btn-secondary text-xs">{label}</a>
        ))}
      </nav>
      <section id="profile" className="card scroll-mt-20 p-6">
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

      {hidden.length > 0 && (
        <section id="hidden-classes" className="card scroll-mt-20 p-6">
          <h2 className="text-base font-semibold">{s.courses.hidden}</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {hidden.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{entry.name}</p>
                  <p className="text-slate-600">{kindLabel(entry.kind, locale)} · {dayName(entry.movedDay ?? entry.day, locale)} · {formatMinutes(entry.movedTime ?? entry.time)}</p>
                </div>
                <form action={restoreHiddenClass.bind(null, entry.id)}>
                  <button className="btn-secondary">{s.courses.restore}<span className="sr-only"> · {entry.name}</span></button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="export" className="card scroll-mt-20 p-6">
        <h2 className="mb-4 text-base font-semibold">{s.export.title}</h2>
        <ExportPanel
          mailConfigured={mailConfigured()}
          defaultEmail={user.exportEmail ?? user.email}
          googleConfigured={googleConfigured()}
          connected={!!user.googleRefreshToken}
          syncMode={googleSyncMode(user.id)}
          syncedAt={user.googleSyncedAt}
          syncDelayed={Boolean(user.googleRefreshToken) && googleSyncDelayed(user.id)}
          feedPath={`/api/ics/${user.feedToken}.ics`}
          flash={typeof params.google === "string" ? params.google : null}
        />
      </section>

      <section id="language" className="card scroll-mt-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{s.language.title}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{s.language.hint}</p>
        </div>
        <LanguageSwitch />
      </section>

      {faculty && (
        <details className="card p-5">
          <summary className="cursor-pointer font-semibold">{s.documents.title(faculty.shortName ?? faculty.name)}</summary>
          <p className="mb-3 mt-1 text-sm text-slate-600">{s.documents.hint}</p>
          {documents.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a className="text-brand-700 hover:underline" href={d.pdfId ? `/api/timetables/${d.pdfId}` : d.url} target="_blank" rel="noreferrer">{d.label}</a>
                    {d.status === "partial" && <p className="text-xs text-amber-800">{importDiagnostic(d.message, locale)}</p>}
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
        </details>
      )}

      <p className="text-xs text-slate-500">{s.page.signedInAs(user.email, s.page.roles[user.role] ?? user.role)}</p>
    </div>
  );
}
