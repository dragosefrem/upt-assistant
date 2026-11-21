"use client";

import { Mascot, askAssistant } from "./Mascot";

const ACTIONS = [
  { emoji: "⏭️", label: "What's next?", question: "What's next?" },
  { emoji: "📅", label: "Tomorrow", question: "Ce am mâine?" },
  { emoji: "📝", label: "My exams", question: "Where is my next exam?" },
  { emoji: "☕", label: "Free time", question: "When am I free this week?" },
  { emoji: "🧭", label: "Directions", question: "Cum ajung la sala următoare?" },
];

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Hi";
  return "Good evening";
}

/** Friendly welcome card: a greeting from the mascot and one-tap questions for the assistant. */
export function QuickActions({ name, hour }: { name: string; hour: number }) {
  const first = name.split(/\s+/)[0] || name;
  return (
    <section className="card relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-500 p-4 text-white sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 right-24 h-28 w-28 rounded-full bg-amber-300/20" />
      <div className="relative flex items-center gap-4">
        <div className="hidden rounded-2xl bg-white/15 p-2 sm:block">
          <Mascot size={64} wave />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{greeting(hour)}, {first}! 👋</h1>
          <p className="mt-0.5 text-sm text-white/85">I&apos;m Poli. Tap a question, or ask me anything in the chat.</p>
        </div>
      </div>
      <div className="relative mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => askAssistant(a.question)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-sm font-medium text-brand-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span aria-hidden>{a.emoji}</span>
            {a.label}
          </button>
        ))}
      </div>
    </section>
  );
}
