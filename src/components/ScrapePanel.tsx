"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/i18n/client";
import { DATE_LOCALE } from "@/i18n/config";
import { TIME_ZONE } from "@/lib/time";

interface Run {
  id: number;
  status: string;
  scope: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  log: string;
  stats: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  running: "bg-brand-50 text-brand-700",
  success: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
};

/** Controls for the scraping engine, with the log of the run in progress. */
export function ScrapePanel({ faculties, initialRuns }: { faculties: Array<{ id: number; label: string }>; initialRuns: Run[] }) {
  const t = useT().admin.scrape;
  const locale = useLocale();
  const router = useRouter();
  const [catalog, setCatalog] = useState(true);
  const [timetables, setTimetables] = useState(true);
  const [exams, setExams] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [runs, setRuns] = useState(initialRuns);
  const [active, setActive] = useState<Run | null>(initialRuns.find((r) => r.status === "running") ?? initialRuns[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const poll = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/admin/scrape?run=${id}`, { cache: "no-store" });
      if (!res.ok) return null;
      const { run } = (await res.json()) as { run: Run };
      setActive(run);
      setRuns((list) => [run, ...list.filter((r) => r.id !== run.id)].sort((a, b) => b.id - a.id));
      if (run.status !== "running") router.refresh();
      return run;
    },
    [router],
  );

  const running = active?.status === "running";
  const activeId = active?.id;
  useEffect(() => {
    if (!running || !activeId) return;
    const timer = setInterval(() => void poll(activeId), 1500);
    return () => clearInterval(timer);
  }, [running, activeId, poll]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [active?.log]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog, timetables, exams, dryRun, facultyIds: selected }),
      });
      const data = await res.json();
      if (!res.ok && !data.runId) throw new Error(data.error ?? t.couldNotStart);
      if (!res.ok) setError(data.error);
      if (data.runId) await poll(data.runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const check = (label: string, value: boolean, set: (v: boolean) => void, hint: string) => (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
      <span>
        <span className="font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-4">
        <div className="space-y-3">
          {check(t.catalog, catalog, setCatalog, t.catalogHint)}
          {check(t.timetables, timetables, setTimetables, t.timetablesHint)}
          {check(t.exams, exams, setExams, t.examsHint)}
          {check(t.dryRun, dryRun, setDryRun, t.dryRunHint)}
        </div>
        <div>
          <p className="label">{t.faculties}</p>
          <div className="flex flex-wrap gap-1.5">
            <button className={`rounded-full border px-2.5 py-1 text-xs ${selected.length === 0 ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`} onClick={() => setSelected([])}>
              {t.all}
            </button>
            {faculties.map((f) => {
              const on = selected.includes(f.id);
              return (
                <button
                  key={f.id}
                  className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  onClick={() => setSelected(on ? selected.filter((id) => id !== f.id) : [...selected, f.id])}
                  aria-pressed={on}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {!faculties.length && <p className="text-xs text-slate-500">{t.noFaculties}</p>}
        </div>
        <button className="btn-primary w-full" onClick={start} disabled={starting || running}>
          {running ? t.inProgress : starting ? t.starting : dryRun ? t.runDry : t.runReplace}
        </button>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {runs.slice(0, 8).map((r) => (
            <button
              key={r.id}
              onClick={() => setActive(r)}
              className={`rounded-full px-2.5 py-1 text-xs ${active?.id === r.id ? "ring-2 ring-brand-500" : ""} ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}
            >
              #{r.id} {t.status[r.status] ?? r.status}{r.dryRun ? ` ${t.dry}` : ""}
            </button>
          ))}
        </div>
        {active ? (
          <>
            <p className="mb-2 text-xs text-slate-500">
              {t.runInfo(
                active.id,
                active.scope.split("+").map((part) => t.scope[part] ?? part).join(" + "),
                new Date(active.startedAt).toLocaleString(DATE_LOCALE[locale], { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }),
              )}
              {active.finishedAt ? t.took(Math.max(1, Math.round((+new Date(active.finishedAt) - +new Date(active.startedAt)) / 1000))) : ""}
            </p>
            <pre ref={logRef} className="h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
              {active.log || t.starting}
            </pre>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">{t.noRuns}</p>
        )}
      </div>
    </div>
  );
}
