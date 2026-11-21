"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { askAssistant } from "./Mascot";

const KEY = "upt-first-week";

/** The first-week checklist. What is ticked is remembered on this device. */
export function GuideChecklist() {
  const t = useT().guide;
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved ticks exist only in the browser
      setDone(new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]));
    } catch {
      // No storage (private mode): the list still works for this visit.
    }
  }, []);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Not saved; nothing else to do.
      }
      return next;
    });
  };

  const count = t.steps.filter((s) => done.has(s.id)).length;
  const total = t.steps.length;
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-label={t.firstWeek.done(count, total)}>
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(count / total) * 100}%` }} />
        </div>
        <p role="status" className="shrink-0 text-xs font-medium text-slate-600">{count === total ? t.firstWeek.allDone : t.firstWeek.done(count, total)}</p>
      </div>
      <ol className="space-y-2">
        {t.steps.map((step, i) => {
          const checked = done.has(step.id);
          return (
            <li key={step.id} className={`flex gap-3 rounded-2xl border px-3 py-3 transition ${checked ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                aria-label={step.title}
                onClick={() => toggle(step.id)}
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 text-slate-400 hover:border-brand-500"}`}
              >
                {checked ? "✓" : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${checked ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"}`}>{step.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
                <p className="mt-2 flex flex-wrap gap-2">
                  {step.href && step.action && (
                    <Link href={step.href} className="btn-secondary px-3 py-1.5 text-xs">{step.action} →</Link>
                  )}
                  {step.ask && (
                    <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => askAssistant(step.ask!)}>
                      💬 {t.firstWeek.askPoli(step.ask)}
                    </button>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
