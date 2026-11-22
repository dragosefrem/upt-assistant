import { ArrowLeft, Check, CircleCheck, Search } from "lucide-react";
import Link from "next/link";
import { setContactSharing, setPrivateSharing } from "@/app/(app)/settings/actions";
import { ExportPanel } from "@/components/ExportPanel";
import { TimetableReviewForm } from "@/components/TimetableReviewForm";
import { DATE_LOCALE } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { googleConfigured, googleSyncDelayed, googleSyncMode } from "@/lib/google";
import { kindLabel } from "@/lib/kinds";
import { mailConfigured } from "@/lib/mail";
import { currentSemester, describeGroup, extraCourseOptions, timetableReview } from "@/lib/schedule";
import { capitalize, dayName, formatMinutes, TIME_ZONE } from "@/lib/time";
import { addExtraCourseAction } from "./actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.timetableSettings.page.title };
}

type Choice = { value: string; label: string; hint: string; active: boolean };

/** One sharing question: a row of buttons, each submitting its own value. */
function ChoiceGroup({ name, legend, hint, action, choices }: {
  name: string; legend: string; hint: string; action: (form: FormData) => Promise<void>; choices: Choice[];
}) {
  return (
    <form action={action}>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2">
          <span className="block text-sm font-semibold text-slate-900">{legend}</span>
          <span className="block text-xs text-slate-600">{hint}</span>
        </legend>
        {choices.map((c) => (
          <button key={c.value} type="submit" name={name} value={c.value} aria-pressed={c.active}
            className={`flex items-start gap-2.5 rounded-xl border p-3 text-left ${c.active ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"}`}>
            <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${c.active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-400"}`}>
              {c.active && <Check size={12} strokeWidth={3} />}
            </span>
            <span>
              <span className="block text-sm font-semibold">{c.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-600">{c.hint}</span>
            </span>
          </button>
        ))}
      </fieldset>
    </form>
  );
}

export default async function TimetableSettingsPage({ searchParams }: PageProps<"/timetable-settings">) {
  const user = await requireOnboardedUser();
  const [messages, locale, params] = await Promise.all([getT(), getLocale(), searchParams]);
  const t = messages.timetableSettings;
  const s = messages.settings;
  const semester = currentSemester();
  const group = describeGroup(user.groupId, locale);
  const review = semester ? timetableReview(user, semester, locale) : [];
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const options = semester && query ? extraCourseOptions(user, semester, query, locale) : [];
  const flash = params.saved === "confirmed" ? t.review.confirmedNow
    : params.saved ? t.review.saved
      : params.extra === "added" ? t.extra.added
        : params.extra === "removed" ? t.extra.removed : null;
  const confirmedOn = user.timetableConfirmedAt
    ? new Date(user.timetableConfirmedAt).toLocaleDateString(DATE_LOCALE[locale], { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE })
    : null;
  const sessionLine = (session: { kind: string; day: number; startMin: number }) =>
    `${kindLabel(session.kind, locale)} ${capitalize(dayName(session.day, locale, "short"))} ${formatMinutes(session.startMin)}`;
  const nav = [["courses", t.page.nav.courses], ["extra", t.page.nav.extra], ["export", t.page.nav.export], ["privacy", t.page.nav.privacy]] as const;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="page-heading space-y-2">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft size={15} aria-hidden />{t.page.back}
        </Link>
        <h1>{t.page.title}</h1>
        {group && (
          <p className="text-sm text-slate-600">
            {group.faculty.shortName ?? group.faculty.name} · {group.spec.name} · {messages.common.time.year(group.group.year)} · {group.label === messages.common.time.wholeYear ? group.label : messages.common.time.group(group.label)}
            {semester ? ` · ${messages.common.time.semester(semester.number, semester.academicYear)}` : ""}
          </p>
        )}
        <p className="text-sm text-slate-600">{t.page.intro}</p>
      </header>

      <nav aria-label={t.page.title} className="flex flex-wrap gap-2">
        {nav.filter(([id]) => id !== "extra" || (user.groupId && semester)).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="btn-secondary text-xs">{label}</a>
        ))}
      </nav>

      <section id="courses" className="card scroll-mt-20 p-4 sm:p-6" aria-labelledby="courses-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="courses-heading" className="text-base font-semibold">{t.review.title}</h2>
          {review.length > 0 && (
            confirmedOn
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"><CircleCheck size={13} aria-hidden />{t.review.confirmed(confirmedOn)}</span>
              : <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">{t.review.notConfirmed}</span>
          )}
        </div>
        {flash && <p role="status" className="my-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{flash}</p>}
        {!user.groupId ? (
          <p className="mt-2 text-sm text-slate-600">
            {t.page.noGroup} <Link href="/settings#profile" className="font-medium text-brand-700 underline">{t.page.chooseGroup}</Link>
          </p>
        ) : !semester ? (
          <p className="mt-2 text-sm text-slate-600">{t.page.noSemester}</p>
        ) : (
          <>
            {review.length > 0 && <p className="mb-4 mt-1 text-sm text-slate-600">{t.review.hint}</p>}
            <TimetableReviewForm courses={review} />
            <p className="mt-4 text-xs text-slate-500">
              <Link href="/settings#documents" className="underline">{t.review.wrong}</Link>
            </p>
          </>
        )}
      </section>

      {user.groupId && semester && (
        <section id="extra" className="card scroll-mt-20 p-4 sm:p-6" aria-labelledby="extra-heading">
          <h2 id="extra-heading" className="text-base font-semibold">{t.extra.title}</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">{t.extra.hint}</p>
          {params.extra === "unavailable" && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t.extra.unavailable}</p>}
          <form method="get" action="/timetable-settings#extra" role="search" className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="extra-query" className="sr-only">{t.extra.search}</label>
            <input id="extra-query" name="q" type="search" defaultValue={query} placeholder={t.extra.placeholder} minLength={2} maxLength={80}
              className="field sm:flex-1" />
            <button className="btn-secondary shrink-0"><Search size={15} aria-hidden />{t.extra.searchButton}</button>
          </form>
          {query && query.length < 2 && <p className="mt-3 text-sm text-slate-600">{t.extra.tooShort}</p>}
          {query.length >= 2 && !options.length && <p className="mt-3 text-sm text-slate-600">{t.extra.noResults(query)}</p>}
          {options.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {options.map((course) => (
                <li key={course.courseId} className="px-4 py-3">
                  <p className="text-sm">
                    <span className="font-semibold text-slate-900">{course.name}</span>
                    {course.abbr && <span className="ml-2 text-xs text-slate-500">{course.abbr}</span>}
                    {course.year && <span className="ml-2 text-xs text-slate-500">{t.extra.yearOf(course.year)}</span>}
                  </p>
                  <form action={addExtraCourseAction} className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="courseId" value={course.courseId} />
                    <select name="groupId" aria-label={t.extra.group(course.name)} className="field min-w-0 sm:flex-1" required>
                      {course.groups.map((g) => (
                        <option key={g.groupId} value={g.groupId}>
                          {g.specialization} · {messages.common.time.year(g.year)} · {g.label} — {g.sessions.slice(0, 3).map(sessionLine).join(", ")}
                          {g.sessions.length > 3 ? ` (+${g.sessions.length - 3})` : ""}
                        </option>
                      ))}
                    </select>
                    <button className="btn-primary shrink-0">{t.extra.add}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section id="export" className="card scroll-mt-20 p-4 sm:p-6" aria-labelledby="export-heading">
        <h2 id="export-heading" className="mb-4 text-base font-semibold">{s.export.title}</h2>
        <ExportPanel
          mailConfigured={mailConfigured("calendar")}
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

      <section id="privacy" className="card scroll-mt-20 space-y-5 p-4 sm:p-6" aria-labelledby="privacy-heading">
        <div>
          <h2 id="privacy-heading" className="text-base font-semibold">{t.privacy.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{t.privacy.hint}</p>
        </div>
        <ChoiceGroup name="sharing" legend={t.privacy.timetable.title} hint={t.privacy.timetable.hint} action={setContactSharing}
          choices={(["details", "availability"] as const).map((mode) => ({
            value: mode, label: s.contactPrivacy[mode].label, hint: s.contactPrivacy[mode].hint,
            active: user.shareActivityDetails === (mode === "details"),
          }))} />
        <ChoiceGroup name="private" legend={t.privacy.personal.title} hint={t.privacy.personal.hint} action={setPrivateSharing}
          choices={(["busy", "details"] as const).map((mode) => ({
            value: mode, label: t.privacy.personal[mode].label, hint: t.privacy.personal[mode].hint,
            active: user.sharePrivateDetails === (mode === "details"),
          }))} />
      </section>
    </div>
  );
}
