"use client";

import { useT } from "@/i18n/client";
import { Mascot, askAssistant } from "./Mascot";

/** Chips in display order; label and question come from the catalogue, in the interface language. */
const ACTIONS = [
  { key: "next", emoji: "⏭️" },
  { key: "tomorrow", emoji: "📅" },
  { key: "exams", emoji: "📝" },
  { key: "free", emoji: "☕" },
  { key: "directions", emoji: "🧭" },
] as const;

/** Friendly welcome card: a greeting from the mascot and one-tap questions for the assistant. */
export function QuickActions({ name, hour }: { name: string; hour: number }) {
  const t = useT().calendar.quick;
  const first = name.split(/\s+/)[0] || name;
  const greeting = hour < 12 ? t.morning : hour < 18 ? t.day : t.evening;
  return (
    <section className="card relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-500 p-4 text-white sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 right-24 h-28 w-28 rounded-full bg-amber-300/20" />
      <div className="relative flex items-center gap-4">
        <div className="hidden rounded-2xl bg-white/15 p-2 sm:block">
          <Mascot size={64} wave />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t.hello(greeting, first)}</h1>
          <p className="mt-0.5 text-sm text-white/85">{t.intro}</p>
        </div>
      </div>
      <div className="relative mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => askAssistant(t.chips[a.key].question)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-brand-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span aria-hidden>{a.emoji}</span>
            {t.chips[a.key].label}
          </button>
        ))}
      </div>
    </section>
  );
}
