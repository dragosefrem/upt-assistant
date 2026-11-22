"use client";

import { Check, CircleCheck, Pencil, Plus, Target } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { saveAttendanceGoal } from "@/app/(app)/attendance/actions";
import { useLocale, useT } from "@/i18n/client";
import type { AttendanceActivity, AttendanceGoalOverview } from "@/lib/attendance-goals";
import { attendanceActivityId, kindLabel, kindStyle } from "@/lib/kinds";
import { Modal } from "./Modal";

function ActivityKind({ kind }: Pick<AttendanceActivity, "kind">) {
  const locale = useLocale();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <span aria-hidden className={`size-2 rounded-full ${kindStyle(kind).dot}`} />
      {kindLabel(kind, locale)}
    </span>
  );
}

function GoalEditor({ activity, onClose, onSaved }: {
  activity: AttendanceActivity;
  onClose: () => void;
  onSaved: (minimum: number | null) => void;
}) {
  const messages = useT();
  const t = messages.attendance.goals;
  const [value, setValue] = useState(activity.minimum?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  const minimum = Number(value);
  const valid = Number.isSafeInteger(minimum) && minimum > 0;
  const remaining = minimum - activity.attended;

  function save(next: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveAttendanceGoal(attendanceActivityId(activity), next);
        if (result.error) setError(result.error);
        else onSaved(next);
      } catch {
        setError(messages.common.status.somethingWrong);
      }
    });
  }

  return (
    <Modal title={activity.minimum === null ? t.set : t.edit} onClose={() => { if (!pending) onClose(); }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (valid) save(minimum);
        else setError(t.invalidMinimum);
      }}>
        <ActivityKind kind={activity.kind} />
        <p className="mt-1 text-xl font-semibold leading-snug tracking-tight">{activity.title}</p>
        <label className="mt-5 block">
          <span className="label">{t.minimum}</span>
          <input ref={input} type="number" inputMode="numeric" min="1" step="1" required
            className="field max-w-36 tabular-nums" value={value} placeholder={t.example}
            aria-describedby="goal-preview" disabled={pending} onFocus={(event) => event.target.select()}
            onChange={(event) => { setValue(event.target.value); setError(null); }} />
        </label>
        <p id="goal-preview" aria-live="polite" className="mt-2 text-sm text-slate-600">
          {t.attendedCount(activity.attended)}{valid && <> · {remaining > 0 ? t.remaining(remaining) : t.met}</>}
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={pending}>{pending ? messages.common.status.saving : t.save}</button>
          <button type="button" className="btn-ghost" disabled={pending} onClick={onClose}>{messages.common.actions.cancel}</button>
          {activity.minimum !== null && (
            <button type="button" className="btn-ghost text-red-700 sm:ml-auto" disabled={pending} onClick={() => save(null)}>{t.remove}</button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function AttendanceGoals({ goals, available }: AttendanceGoalOverview) {
  const messages = useT();
  const t = messages.attendance.goals;
  const locale = useLocale();
  const [editing, setEditing] = useState<AttendanceActivity | null>(null);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfterSave = useRef<{ id: string; minimum: number | null } | null>(null);
  const met = goals.filter((goal) => goal.remaining === 0).length;
  const activityName = (activity: AttendanceActivity) => `${activity.title} · ${kindLabel(activity.kind, locale)}`;

  function finish(minimum: number | null) {
    if (!editing) return;
    focusAfterSave.current = { id: attendanceActivityId(editing), minimum };
    setNotice(minimum === null ? t.removed(activityName(editing)) : t.saved(activityName(editing)));
    setEditing(null);
  }

  useLayoutEffect(() => {
    const target = focusAfterSave.current;
    if (editing || !target) return;
    // Wait for the refreshed list. The original button can disappear when a class changes sections.
    const goal = goals.find((g) => attendanceActivityId(g) === target.id);
    if ((goal?.minimum ?? null) !== target.minimum) return;
    (document.getElementById(`${target.id}-edit`) ?? heading.current)?.focus();
    focusAfterSave.current = null;
  }, [editing, goals]);

  return (
    <div className="space-y-7">
      {goals.length > 0 && (
        <section aria-labelledby="tracked-goals">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="tracked-goals" ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight">{t.heading}</h2>
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                <CircleCheck size={15} aria-hidden />{t.metCount(met, goals.length)}
              </span>
            </div>
            {available.length > 0 && (
              <a href="#available-classes" aria-label={t.add} className="btn-secondary shrink-0">
                <Plus size={16} aria-hidden /><span className="sm:hidden">{messages.common.actions.add}</span><span className="hidden sm:inline">{t.add}</span>
              </a>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {goals.map((goal) => {
              const id = attendanceActivityId(goal);
              const reached = goal.remaining === 0;
              return (
                <article key={id} id={id} tabIndex={-1} className="card flex scroll-mt-20 flex-col p-4 target:ring-2 target:ring-brand-500 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <ActivityKind kind={goal.kind} />
                    <button id={`${id}-edit`} type="button" onClick={() => setEditing(goal)}
                      aria-label={`${t.edit} · ${activityName(goal)}`} title={t.edit}
                      className="btn-ghost -mr-2 -my-2 size-11 p-0">
                      <Pencil size={15} aria-hidden />
                    </button>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold leading-snug tracking-tight text-ink">{goal.title}</h3>
                  {!goal.onTimetable && <p className="mt-1 text-xs text-slate-500">{t.offTimetable}</p>}
                  <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-5">
                    <p className="flex items-baseline gap-1.5 tabular-nums">
                      <strong className="text-3xl font-semibold tracking-tight">{goal.attended}</strong>
                      <span className="text-base text-slate-500">/ {goal.minimum}</span>
                      <span className="text-xs text-slate-600">{t.unit}</span>
                    </p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${reached ? "bg-emerald-50 text-emerald-800" : goal.outOfReach ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-700"}`}>
                      {reached && <Check size={14} aria-hidden />}{reached ? t.met : t.remaining(goal.remaining)}
                    </span>
                  </div>
                  {!reached && goal.sessionsToCome !== null && (
                    <p className={`mt-2 text-xs leading-relaxed ${goal.outOfReach ? "font-medium text-amber-900" : "text-slate-600"}`}>
                      {goal.outOfReach ? t.outOfReach(goal.sessionsToCome) : t.sessionsToCome(goal.sessionsToCome)}
                    </p>
                  )}
                  <div role="progressbar" aria-label={activityName(goal)} aria-valuemin={0} aria-valuemax={goal.minimum}
                    aria-valuenow={Math.min(goal.attended, goal.minimum)} aria-valuetext={t.progress(goal.attended, goal.minimum)}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${reached ? "bg-emerald-600" : "bg-brand-500"}`}
                      style={{ width: `${Math.min(100, 100 * goal.attended / goal.minimum)}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section className="card overflow-hidden" aria-labelledby="available-classes">
          <header className="flex items-center gap-3 border-b border-slate-100 bg-brand-50/60 px-4 py-4 sm:px-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand-700"><Target size={21} aria-hidden /></span>
            <div>
              <h2 id="available-classes" ref={goals.length ? undefined : heading} tabIndex={-1} className="scroll-mt-24 font-semibold text-ink">
                {goals.length ? t.available : t.first}
              </h2>
              {!goals.length && <p className="mt-0.5 text-sm text-slate-600">{t.choose}</p>}
            </div>
          </header>
          <ul className="divide-y divide-slate-100">
            {available.map((activity) => {
              const id = attendanceActivityId(activity);
              return (
                <li key={id} id={id} tabIndex={-1} className="scroll-mt-20 target:bg-brand-50">
                  <button type="button" id={`${id}-edit`} onClick={() => setEditing(activity)}
                    aria-label={`${t.set} · ${activityName(activity)}`}
                    className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:-outline-offset-2 sm:px-5">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{activity.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <ActivityKind kind={activity.kind} /><span aria-hidden>·</span>{t.attendedCount(activity.attended)}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 p-2 font-semibold text-brand-700 group-hover:underline sm:bg-transparent sm:p-0 sm:text-sm">
                      <Plus size={16} aria-hidden /><span className="hidden sm:inline">{t.set}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!goals.length && !available.length && (
        <section className="card p-5">
          <Target size={24} aria-hidden className="mb-3 text-brand-700" />
          <h2 ref={heading} tabIndex={-1} className="font-semibold">{t.noClasses}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">{t.noClassesHint}</p>
          <Link href="/settings#courses" className="font-semibold text-brand-700 underline">{t.settings}</Link>
        </section>
      )}
      <p role="status" className="sr-only">{notice}</p>
      {editing && <GoalEditor activity={editing} onClose={() => setEditing(null)} onSaved={finish} />}
    </div>
  );
}
