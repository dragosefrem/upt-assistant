"use client";

import { useActionState, useMemo, useState } from "react";
import type { ProfileState } from "@/app/onboarding/actions";
import type { PickerData } from "@/lib/catalog";

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
}: {
  data: PickerData;
  initial: Initial;
  action: (prev: ProfileState, form: FormData) => Promise<ProfileState>;
  submitLabel: string;
}) {
  const initialSpec = data.specializations.find((s) => s.id === initial.specializationId);
  const [facultyId, setFacultyId] = useState<number | null>(initial.facultyId);
  const [degree, setDegree] = useState<"bachelor" | "master">(initialSpec?.degree ?? "bachelor");
  const [year, setYear] = useState<number | null>(initial.year);
  const [specId, setSpecId] = useState<number | null>(initial.specializationId);
  const [groupId, setGroupId] = useState<number | null>(initial.groupId);
  const [state, formAction, pending] = useActionState(action, {});

  const faculty = data.faculties.find((f) => f.id === facultyId);
  const specs = useMemo(
    () => data.specializations.filter((s) => s.facultyId === facultyId && s.degree === degree),
    [data.specializations, facultyId, degree],
  );
  const maxYear = degree === "master" ? 2 : Math.max(4, ...specs.map((s) => s.durationYears ?? 4));
  const withTimetable = useMemo(
    () => new Set(data.groups.filter((g) => g.year === year).map((g) => g.specializationId)),
    [data.groups, year],
  );
  const sortedSpecs = useMemo(
    () => [...specs].sort((a, b) => Number(withTimetable.has(b.id)) - Number(withTimetable.has(a.id)) || a.name.localeCompare(b.name)),
    [specs, withTimetable],
  );
  const groups = data.groups.filter((g) => g.specializationId === specId && g.year === year);
  const seriesList = [...new Set(groups.map((g) => g.series))];

  const step = (n: number, title: string, done: boolean) => (
    <div className="mb-2 flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"}`}>{n}</span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-left text-sm transition ${active ? "border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"}`;

  return (
    <form action={formAction} className="space-y-7">
      <input type="hidden" name="facultyId" value={facultyId ?? ""} />
      <input type="hidden" name="specializationId" value={specId ?? ""} />
      <input type="hidden" name="year" value={year ?? ""} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />

      <section>
        {step(1, "Faculty", !!facultyId)}
        <div className="grid gap-2 sm:grid-cols-2">
          {data.faculties.map((f) => (
            <button
              type="button"
              key={f.id}
              className={chip(f.id === facultyId)}
              onClick={() => {
                setFacultyId(f.id);
                setSpecId(null);
                setGroupId(null);
              }}
            >
              {f.shortName && <span className="mr-2 font-semibold">{f.shortName}</span>}
              <span className="text-slate-600">{f.name.replace(/^Facultatea de /, "")}</span>
            </button>
          ))}
        </div>
        {!data.faculties.length && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No faculties have been imported yet. An administrator needs to run the UPT scrape first.
          </p>
        )}
      </section>

      {facultyId && (
        <section>
          {step(2, "Study cycle and year", !!year)}
          <div className="flex flex-wrap items-center gap-2">
            {(["bachelor", "master"] as const).map((d) => (
              <button
                type="button"
                key={d}
                className={chip(degree === d)}
                onClick={() => {
                  setDegree(d);
                  setSpecId(null);
                  setGroupId(null);
                  if (d === "master" && (year ?? 0) > 2) setYear(null);
                }}
              >
                {d === "bachelor" ? "Bachelor (licență)" : "Master"}
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-slate-200" />
            {Array.from({ length: maxYear }, (_, i) => i + 1).map((y) => (
              <button
                type="button"
                key={y}
                className={chip(year === y)}
                onClick={() => {
                  setYear(y);
                  setGroupId(null);
                }}
              >
                Year {y}
              </button>
            ))}
          </div>
        </section>
      )}

      {facultyId && year && (
        <section>
          {step(3, "Specialization", !!specId)}
          <div className="grid gap-2 sm:grid-cols-2">
            {sortedSpecs.map((s) => (
              <button
                type="button"
                key={s.id}
                className={chip(s.id === specId)}
                onClick={() => {
                  setSpecId(s.id);
                  setGroupId(null);
                }}
              >
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {[s.code, s.language].filter(Boolean).join(" · ")}
                </span>
                {!withTimetable.has(s.id) && <span className="mt-0.5 block text-xs text-slate-400">No timetable imported for year {year}</span>}
              </button>
            ))}
          </div>
          {!sortedSpecs.length && <p className="text-sm text-slate-500">No programmes listed for this cycle.</p>}
        </section>
      )}

      {specId && year && (
        <section>
          {step(4, "Group", !!groupId)}
          {groups.length ? (
            <div className="space-y-3">
              {seriesList.map((series) => (
                <div key={series}>
                  {series && <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{series}</p>}
                  <div className="flex flex-wrap gap-2">
                    {groups
                      .filter((g) => g.series === series)
                      .map((g) => (
                        <button type="button" key={g.id} className={chip(g.id === groupId)} onClick={() => setGroupId(g.id)}>
                          {g.name || "Whole year"}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This faculty publishes its timetable in a format that could not be imported automatically, so there are no
              groups to choose from. You can continue without one
              {faculty?.scheduleUrl ? (
                <>
                  {" "}and open the{" "}
                  <a className="font-medium underline" href={faculty.scheduleUrl} target="_blank" rel="noreferrer">
                    faculty&apos;s timetable page
                  </a>
                </>
              ) : null}
              ; exams, personal events and the assistant still work.
            </p>
          )}
        </section>
      )}

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary" disabled={pending || !specId || !year || (groups.length > 0 && !groupId)}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
