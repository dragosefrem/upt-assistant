"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { finishWelcomeAction } from "@/app/onboarding/actions";
import { useT } from "@/i18n/client";
import { MASCOT_SRC } from "./Mascot";

/**
 * Four short slides shown once, the first time a student reaches the app after setting
 * up their account. Skipping or finishing records it on the account, so it does not
 * come back on another device.
 */
export function WelcomeTour({ name }: { name: string }) {
  const t = useT().onboarding.tour;
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const first = name.trim().split(/\s+/)[0] || name;
  const slide = t.slides[index];
  const last = index === t.slides.length - 1;

  const finish = () => {
    setOpen(false);
    void finishWelcomeAction();
  };

  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, t.slides.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, t.slides.length]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-3 backdrop-blur-sm sm:items-center">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        tabIndex={-1}
        className="card w-full max-w-md animate-pop overflow-hidden outline-none"
      >
        <div className="relative bg-gradient-to-br from-brand-600 to-brand-500 px-6 pb-8 pt-6 text-white">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10" />
          <button type="button" onClick={finish} className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium text-white/85 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white">
            {t.skip}
          </button>
          <div className="relative flex items-end gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture */}
            <img src={MASCOT_SRC} alt="" width={64} height={64} className="rounded-2xl bg-white/15 p-1.5" />
            <span aria-hidden className="text-4xl">{slide.emoji}</span>
          </div>
        </div>
        <div className="px-6 pb-5 pt-5" aria-live="polite">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">{slide.title(first)}</h2>
          <p className="mt-2 min-h-[6.5rem] text-sm leading-relaxed text-slate-600">{slide.body}</p>
          <div className="mt-4 flex items-center gap-3">
            <ol className="flex gap-1.5" aria-label={t.progress(index + 1, t.slides.length)}>
              {t.slides.map((s, i) => (
                <li key={s.emoji} aria-hidden className={`h-2 rounded-full transition-all motion-reduce:transition-none ${i === index ? "w-6 bg-brand-600" : "w-2 bg-slate-200"}`} />
              ))}
            </ol>
            <div className="ml-auto flex gap-2">
              {index > 0 && (
                <button type="button" className="btn-ghost" onClick={() => setIndex(index - 1)}>{t.back}</button>
              )}
              {last ? (
                <button type="button" className="btn-primary" onClick={finish}>{t.done}</button>
              ) : (
                <button type="button" className="btn-primary" onClick={() => setIndex(index + 1)}>{t.next}</button>
              )}
            </div>
          </div>
          {last && (
            <Link href="/guide" onClick={finish} className="mt-3 block text-center text-sm font-medium text-brand-700 hover:underline">
              🎓 {t.openGuide} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
