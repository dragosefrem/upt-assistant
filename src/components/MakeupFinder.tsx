"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { campusJourneyHref } from "@/lib/campuspath/links";
import { kindLabel } from "@/lib/kinds";
import { capitalize, formatDate, formatMinutes, formatTimeSlot } from "@/lib/time";
import { Modal } from "./Modal";

interface Session {
  entryId: number;
  date: string;
  startMin: number;
  endMin: number;
  room: string | null;
  teacher: string | null;
  groups: string[];
  sameYear: boolean;
  clashes: Array<{ title: string; kind: string; startMin: number; endMin: number }>;
}

/** Other groups' sessions of a lab the student missed, the ones that fit their timetable first. */
export function MakeupFinder({ course, kind, onClose }: { course: string; kind: string; onClose: () => void }) {
  const messages = useT();
  const t = messages.study.makeup;
  const locale = useLocale();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/makeup?course=${encodeURIComponent(course)}&kind=${encodeURIComponent(kind)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { sessions: Session[] }) => alive && setSessions(data.sessions))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [course, kind]);

  return (
    <Modal title={t.title(`${course} · ${kindLabel(kind, locale)}`)} onClose={onClose}>
      <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.intro}</p>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">{t.failed}</p>
      ) : !sessions ? (
        <p className="text-sm text-slate-500">{t.loading}</p>
      ) : !sessions.length ? (
        <p className="text-sm text-slate-600">{t.none}</p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={`${s.entryId}-${s.date}`} className="rounded-2xl border border-slate-200 px-3 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  {capitalize(formatDate(s.date, { weekday: "long", day: "numeric", month: "long" }, locale))} · <span className="tabular-nums">{formatTimeSlot(s.startMin, s.endMin)}</span>
                </p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.clashes.length ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {s.clashes.length ? t.clashes(s.clashes.map((c) => c.title).join(", ")) : t.fits}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {s.room && (
                  <Link href={campusJourneyHref({ to: s.room, course, date: s.date, at: formatMinutes(s.startMin) })} className="font-medium text-brand-700 hover:underline">{s.room}</Link>
                )}
                {s.room && s.groups.length > 0 && " · "}
                {s.groups.length > 0 && t.groups(s.groups.join(", "))}
                {s.sameYear && <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{t.sameYear}</span>}
              </p>
              {s.teacher && <p className="text-xs text-slate-500">{s.teacher}</p>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** A small button that opens the finder; for server-rendered lists. */
export function MakeupButton({ course, kind, className = "" }: { course: string; kind: string; className?: string }) {
  const t = useT().study;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`text-xs font-medium text-brand-700 hover:underline ${className}`} onClick={() => setOpen(true)}>
        {t.labs.findMakeup}
      </button>
      {open && <MakeupFinder course={course} kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}
