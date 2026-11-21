import Link from "next/link";
import type { ExamReminder } from "@/lib/reminders";
import { ExamCard } from "./ExamCard";
import { Mascot } from "./Mascot";

/** Home-page card: the next exams with a countdown, or a friendly tip when there are none. */
export function ExamCountdown({ exams, tip }: { exams: ExamReminder[]; tip: string }) {
  const next = exams.slice(0, 2);
  if (!next.length) {
    return (
      <section className="card flex items-center gap-3 p-4">
        <Mascot size={40} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-900">No exams in the next 30 days 🎉</p>
          <p className="text-slate-600">Poli&apos;s tip: {tip}</p>
        </div>
      </section>
    );
  }
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">📝 Upcoming exams</h2>
        <Link href="/exams" className="text-sm font-medium text-brand-600 hover:underline">
          {exams.length > next.length ? `All ${exams.length} exams →` : "Exams page →"}
        </Link>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {next.map((e) => (
          <ExamCard key={e.id} exam={e} compact />
        ))}
      </div>
    </section>
  );
}
