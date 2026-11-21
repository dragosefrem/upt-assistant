"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import type { ProfileState } from "@/app/onboarding/actions";
import { useT } from "@/i18n/client";
import type { PickerData } from "@/lib/catalog";
import { programmeOptions } from "@/lib/profile-options";

interface Initial {
  facultyId: number | null;
  specializationId: number | null;
  year: number | null;
  groupId: number | null;
}

/** Faculty → cycle → year → specialization → group. Later choices reset when earlier ones change. */
export function ProfilePicker({
  data,
  initial,
  action,
  submitLabel,
  draftKey,
}: {
  data: PickerData;
  initial: Initial;
  action: (prev: ProfileState, form: FormData) => Promise<ProfileState>;
  /** Defaults to "Save" in the interface language. */
  submitLabel?: string;
  /** Remember an unfinished onboarding form across reloads in this tab. */
  draftKey?: string;
}) {
  const t = useT();
  const p = t.settings.profile;
  const initialSpec = data.specializations.find((s) => s.id === initial.specializationId);
  const [selection, setSelection] = useState({ ...initial, degree: initialSpec?.degree ?? "bachelor" });
  const { facultyId, degree, year, specializationId: specId, groupId } = selection;
  const [state, formAction, pending] = useActionState(action, {});

  useEffect(() => {
    if (!draftKey) return;
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      if (draft && data.faculties.some((f) => f.id === draft.facultyId) && ["bachelor", "master"].includes(draft.degree)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- tab storage is only available after hydration
        setSelection(draft);
      }
    } catch { /* Storage is optional. */ }
  }, [draftKey, data.faculties]);

  const choose = (changes: Partial<typeof selection>) => {
    const next = { ...selection, ...changes };
    setSelection(next);
    if (draftKey) {
      try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Storage is optional. */ }
    }
  };

  const faculty = data.faculties.find((f) => f.id === facultyId);
  const specs = useMemo(
    () => data.specializations.filter((s) => s.facultyId === facultyId && s.degree === degree),
    [data.specializations, facultyId, degree],
  );
  const specIds = new Set(specs.map((s) => s.id));
  const maxYear = Math.max(0, ...specs.map((s) => s.durationYears ?? (degree === "master" ? 2 : 4)),
    ...data.groups.filter((g) => specIds.has(g.specializationId)).map((g) => g.year));
  const { scheduled, other } = programmeOptions(specs, data.groups, year);
  const validSpec = [...scheduled, ...other].some((s) => s.id === specId);
  const groups = data.groups.filter((g) => g.specializationId === specId && g.year === year);
  const seriesList = [...new Set(groups.map((g) => g.series))];
  const missing = !faculty ? p.chooseFaculty : !specs.length ? p.noCycle : !year ? p.chooseYear : !validSpec ? p.chooseProgramme
    : groups.length && !groups.some((g) => g.id === groupId) ? p.chooseGroup : "";

  const step = (n: number, title: string, done: boolean) => (
    <div className="mb-2 flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition ${active ? "border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`;

  const specButton = (s: PickerData["specializations"][number]) => (
    <button type="button" key={s.id} className={chip(s.id === specId)} aria-pressed={s.id === specId}
      onClick={() => { if (s.id !== specId) choose({ specializationId: s.id, groupId: null }); }}>
      <span className="font-medium">{s.name}</span>
      <span className="ml-2 text-xs text-slate-500">
        {[s.code, (s.language && p.teachingLanguage[s.language]) ?? s.language].filter(Boolean).join(" · ")}
      </span>
      {faculty?.shortName === "AC" && s.code === "CTI" && year === 1 && (
        <span className="block text-xs text-slate-500">{p.sharedFirstYear}</span>
      )}
    </button>
  );

  return (
    <form action={formAction} className="space-y-7">
      <input type="hidden" name="facultyId" value={facultyId ?? ""} />
      <input type="hidden" name="specializationId" value={specId ?? ""} />
      <input type="hidden" name="year" value={year ?? ""} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />

      <section>
        {step(1, p.faculty, !!facultyId)}
        <div className="grid gap-2 sm:grid-cols-2">
          {data.faculties.map((f) => (
            <button
              type="button"
              key={f.id}
              className={chip(f.id === facultyId)}
              aria-pressed={f.id === facultyId}
              onClick={() => {
                if (f.id !== facultyId) choose({ facultyId: f.id, year: null, specializationId: null, groupId: null });
              }}
            >
              {f.shortName && <span className="mr-2 font-semibold">{f.shortName}</span>}
              <span className="text-slate-600">{f.name.replace(/^Facultatea de /, "")}</span>
            </button>
          ))}
        </div>
        {!data.faculties.length && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{p.noFaculties}</p>
        )}
      </section>

      {facultyId && (
        <section>
          {step(2, p.cycleAndYear, !!year)}
          <div className="flex flex-wrap items-center gap-2">
            {(["bachelor", "master"] as const).map((d) => (
              <button
                type="button"
                key={d}
                className={chip(degree === d)}
                aria-pressed={degree === d}
                onClick={() => {
                  if (d !== degree) choose({ degree: d, year: null, specializationId: null, groupId: null });
                }}
              >
                {d === "bachelor" ? p.bachelor : p.master}
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-slate-200" />
            {Array.from({ length: maxYear }, (_, i) => i + 1).map((y) => (
              <button
                type="button"
                key={y}
                className={chip(year === y)}
                aria-pressed={year === y}
                onClick={() => {
                  if (y !== year) choose({ year: y, specializationId: null, groupId: null });
                }}
              >
                {p.year(y)}
              </button>
            ))}
          </div>
        </section>
      )}

      {facultyId && year && (
        <section>
          {step(3, p.specialization, validSpec)}
          <div className="grid gap-2 sm:grid-cols-2">
            {scheduled.map(specButton)}
          </div>
          {other.length > 0 && (
            <details key={`${facultyId}-${degree}-${year}`} className="mt-3" open={!scheduled.length || other.some((s) => s.id === specId)}>
              <summary className="cursor-pointer text-sm text-slate-600">{p.withoutTimetable(year)}</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">{other.map(specButton)}</div>
            </details>
          )}
          {!scheduled.length && !other.length && <p className="text-sm text-slate-500">{p.noProgrammes}</p>}
        </section>
      )}

      {validSpec && year && (
        <section>
          {step(4, p.group, !!groupId)}
          {groups.length ? (
            <div className="space-y-3">
              {seriesList.map((series) => (
                <div key={series} role="group" aria-label={series || p.group}>
                  {series && <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{series}</p>}
                  <div className="flex flex-wrap gap-2">
                    {groups
                      .filter((g) => g.series === series)
                      .map((g) => (
                        <button type="button" key={g.id} className={chip(g.id === groupId)} aria-pressed={g.id === groupId} onClick={() => choose({ groupId: g.id })}>
                          {g.name || p.wholeYear}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {p.noClasses}
              {faculty?.scheduleUrl ? (
                <>
                  {p.noClassesOpen}
                  <a className="font-medium underline" href={faculty.scheduleUrl} target="_blank" rel="noreferrer">
                    {p.facultyPage}
                  </a>
                </>
              ) : null}
              {p.noClassesEnd}
            </p>
          )}
        </section>
      )}

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div>
        <p role="status" id="profile-next-step" className="mb-2 text-sm text-slate-600">{missing}</p>
        <button className="btn-primary" disabled={pending || !!missing} aria-describedby={missing ? "profile-next-step" : undefined}>
          {pending ? t.common.status.saving : (submitLabel ?? t.common.actions.save)}
        </button>
      </div>
    </form>
  );
}
