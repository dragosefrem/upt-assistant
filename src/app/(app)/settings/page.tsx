import { and, eq } from "drizzle-orm";
import { saveProfileAction } from "@/app/onboarding/actions";
import { CourseChoicesForm } from "@/components/CourseChoicesForm";
import { ExportPanel } from "@/components/ExportPanel";
import { ProfilePicker } from "@/components/ProfilePicker";
import { getDb } from "@/db";
import { sources } from "@/db/schema";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf, pickerData } from "@/lib/catalog";
import { googleConfigured } from "@/lib/google";
import { mailConfigured } from "@/lib/mail";
import { courseChoices, currentSemester } from "@/lib/schedule";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const semester = currentSemester();
  const choices = semester ? courseChoices(user, semester) : [];
  const faculty = facultyOf(user.facultyId);
  const documents = user.facultyId
    ? getDb().select().from(sources).where(and(eq(sources.facultyId, user.facultyId), eq(sources.kind, "timetable"))).all()
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card p-6">
        <h2 className="text-base font-semibold">Where you study</h2>
        <p className="mb-5 mt-1 text-sm text-slate-600">Changing your group resets your optional-course choices and the classes you hid or moved.</p>
        <ProfilePicker
          data={pickerData()}
          initial={{ facultyId: user.facultyId, specializationId: user.specializationId, year: user.year, groupId: user.groupId }}
          action={saveProfileAction}
          submitLabel="Save"
        />
      </section>

      <section id="courses" className="card scroll-mt-20 p-6">
        <h2 className="mb-4 text-base font-semibold">Courses and lab slots</h2>
        <CourseChoicesForm choices={choices} returnTo="/settings#courses" submitLabel="Save choices" />
      </section>

      <section id="export" className="card scroll-mt-20 p-6">
        <h2 className="mb-4 text-base font-semibold">Export your calendar</h2>
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
          <h2 className="text-base font-semibold">Published timetables — {faculty.shortName ?? faculty.name}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">The documents your faculty links to for this semester. Those marked “imported” feed your calendar.</p>
          {documents.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <a className="min-w-0 truncate text-brand-700 hover:underline" href={d.url} target="_blank" rel="noreferrer">{d.label}</a>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${d.status === "imported" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                    {d.status === "imported" ? "imported" : d.format.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">
              Nothing found for this semester.
              {faculty.scheduleUrl && (<> See the <a className="text-brand-700 underline" href={faculty.scheduleUrl} target="_blank" rel="noreferrer">faculty&apos;s timetable page</a>.</>)}
            </p>
          )}
        </section>
      )}

      <p className="text-xs text-slate-500">Signed in as {user.email} · {user.role}</p>
    </div>
  );
}
