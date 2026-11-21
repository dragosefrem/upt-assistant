"use client";

import { useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { capitalize, formatDate, formatMinutes, formatTimeSlot } from "@/lib/time";
import { SCHEDULE_CHANGED } from "./Calendar";
import { Mascot } from "./Mascot";

interface PlannedExam {
  key: string;
  course: string;
  date: string;
  startMin: number;
  alsoOn: string[];
  sessions: Array<{ date: string; startMin: number; endMin: number; review: boolean }>;
  short: { planned: number; wanted: number } | null;
}

interface Proposal {
  sessionMinutes: number;
  exams: PlannedExam[];
  saved: number;
  justSaved: boolean;
}

/**
 * The exam study planner on the Exams page: propose a plan that works backwards from
 * each exam, adjust it, and put it into the calendar as the student's own events.
 */
export function StudyPlanCard({ examCount, savedBlocks }: { examCount: number; savedBlocks: number }) {
  const messages = useT();
  const t = messages.study.plan.card;
  const locale = useLocale();
  const [hours, setHours] = useState(12);
  const [perDay, setPerDay] = useState(2);
  const [restSunday, setRestSunday] = useState(true);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [saved, setSaved] = useState(savedBlocks);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (save: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hoursPerExam: hours, maxPerDay: perDay, restOnSunday: restSunday, save }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      setProposal(data as Proposal);
      setSaved(data.saved);
      if (save) {
        setNote({ ok: true, text: t.saved(data.saved) });
        window.dispatchEvent(new Event(SCHEDULE_CHANGED));
      }
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message || t.failed });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/study-plan", { method: "DELETE" });
      if (!res.ok) throw new Error(t.failed);
      setSaved(0);
      setProposal(null);
      setNote({ ok: true, text: t.cleared });
      window.dispatchEvent(new Event(SCHEDULE_CHANGED));
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const day = (date: string) => capitalize(formatDate(date, { weekday: "short", day: "numeric", month: "short" }, locale));

  return (
    <section className="card overflow-hidden" aria-labelledby="study-plan">
      <div className="flex items-start gap-3 bg-gradient-to-r from-brand-50 to-white px-4 py-4 sm:px-5">
        <Mascot size={44} />
        <div className="min-w-0 flex-1">
          <h2 id="study-plan" className="text-base font-semibold text-slate-900">📚 {t.title}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{examCount ? t.intro : t.noExams}</p>
          {saved > 0 && <p className="mt-1 text-sm font-medium text-emerald-700">{t.inCalendar(saved)}</p>}
        </div>
      </div>

      {(examCount > 0 || saved > 0 || note) && (
        <div className="space-y-4 px-4 py-4 sm:px-5">
          {examCount > 0 ? <fieldset className="flex flex-wrap items-end gap-x-5 gap-y-3" disabled={busy}
            onChange={() => { setProposal(null); setNote(null); }}>
            <legend className="sr-only">{t.options}</legend>
            <label className="text-sm">
              <span className="label">{t.hoursPerExam}</span>
              <select className="field w-28" value={hours} onChange={(e) => setHours(+e.target.value)}>
                {[6, 8, 12, 16, 20].map((h) => (<option key={h} value={h}>{t.hours(h)}</option>))}
              </select>
            </label>
            <label className="text-sm">
              <span className="label">{t.blocksPerDay}</span>
              <select className="field w-24" value={perDay} onChange={(e) => setPerDay(+e.target.value)}>
                {[1, 2, 3].map((n) => (<option key={n} value={n}>{n}</option>))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={restSunday} onChange={(e) => setRestSunday(e.target.checked)} />
              {t.restDay}
            </label>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className={proposal ? "btn-secondary" : "btn-primary"} onClick={() => run(false)}>
                {busy && !proposal ? messages.common.status.pleaseWait : proposal ? t.rebuild : t.build}
              </button>
              {saved > 0 && <button type="button" className="btn-ghost" onClick={clear}>{t.clear}</button>}
            </div>
          </fieldset> : saved > 0 && <button type="button" className="btn-ghost" disabled={busy} onClick={clear}>{t.clear}</button>}

          {proposal && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.preview}</h3>
              <ul className="mt-2 grid gap-3 md:grid-cols-2">
                {proposal.exams.map((x) => (
                  <li key={x.key} className="rounded-2xl border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-900">{x.course}</p>
                    <p className="text-xs text-red-700">
                      {t.examOn(`${day(x.date)}, ${formatMinutes(x.startMin)}`)}
                      {x.alsoOn.length > 0 && <span className="block text-slate-500">{t.alsoOn(x.alsoOn.map(day).join(", "))}</span>}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {x.sessions.map((s) => (
                        <li key={`${s.date}-${s.startMin}`} className="flex items-baseline gap-2 text-sm text-slate-700">
                          <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 self-start rounded-full ${s.review ? "bg-amber-500" : "bg-violet-500"}`} />
                          <span>
                            {day(s.date)} · <span className="tabular-nums">{formatTimeSlot(s.startMin, s.endMin)}</span>
                            {s.review && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{t.review}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {x.short && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{t.short(x.short.planned, x.short.wanted)}</p>}
                  </li>
                ))}
              </ul>
              {!proposal.justSaved && (
                <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => run(true)}>
                  {busy ? messages.common.status.saving : t.save}
                </button>
              )}
            </div>
          )}
          {note && (
            <p role="status" className={`rounded-xl px-3 py-2 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{note.text}</p>
          )}
        </div>
      )}
    </section>
  );
}
