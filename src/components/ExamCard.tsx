import type { ExamReminder } from "@/lib/reminders";
import { formatDate, formatMinutes } from "@/lib/time";
import { Mascot } from "./Mascot";

const STAGE_STYLE: Record<ExamReminder["stage"], string> = {
  now: "bg-red-600 text-white",
  today: "bg-red-100 text-red-800",
  tomorrow: "bg-amber-100 text-amber-900",
  soon: "bg-amber-50 text-amber-800",
  week: "bg-brand-50 text-brand-700",
  later: "bg-slate-100 text-slate-700",
};

/** One upcoming exam: countdown, when, where to go, and Poli's suggestions. */
export function ExamCard({ exam, compact = false }: { exam: ExamReminder; compact?: boolean }) {
  const urgent = exam.stage === "now" || exam.stage === "today" || exam.stage === "tomorrow";
  return (
    <article className={`rounded-2xl border bg-white p-4 ${urgent ? "border-red-200 shadow-[0_4px_16px_-6px_rgba(220,38,38,0.25)]" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-red-50 text-red-700">
          <span className="text-[10px] font-semibold uppercase tracking-wide">{formatDate(exam.date, { month: "short" })}</span>
          <span className="text-xl font-bold leading-none">{+exam.date.slice(8)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-900">{exam.course}</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STAGE_STYLE[exam.stage]}`}>{exam.countdown}</span>
          </div>
          <p className="text-sm text-slate-600">
            {formatDate(exam.date, { weekday: "long", day: "numeric", month: "long" })} · {formatMinutes(exam.startMin)}–{formatMinutes(exam.endMin)}
            {exam.teacher ? ` · ${exam.teacher}` : ""}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
            <span aria-hidden>📍</span>
            <span className="font-semibold text-slate-900">{exam.room ? `Room ${exam.room}` : "Room not published yet"}</span>
            {exam.place && (
              <span className="text-slate-600">
                {exam.place.name}
                {exam.place.address ? `, ${exam.place.address}` : ""}
                {exam.place.approximate ? " (approximate)" : ""}
              </span>
            )}
            {exam.mapsUrl && (
              <a href={exam.mapsUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
                Open map ↗
              </a>
            )}
          </p>
        </div>
      </div>
      {exam.tips.length > 0 && (
        <div className="mt-3 flex items-start gap-2">
          <Mascot size={28} className="mt-0.5" />
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-brand-50 px-3 py-2 text-sm text-slate-800">
            {compact ? (
              <p>{exam.tips[0]}</p>
            ) : (
              <ul className="space-y-1">
                {exam.tips.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden className="text-brand-500">•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
