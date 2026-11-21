"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { finishWelcomeAction } from "@/app/onboarding/actions";
import { useT } from "@/i18n/client";
import { MASCOT_SRC } from "./Mascot";

/**
 * Four short slides shown once, the first time a student reaches the app after setting
 * up their account. Skipping or finishing records it on the account, so it does not
 * come back on another device.
 */
export function WelcomeTour({ name }: { name: string }) {
  const messages = useT();
  const t = messages.onboarding.tour;
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(0);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const first = name.trim().split(/\s+/)[0] || name;
  const slide = t.slides[index];
  const last = index === t.slides.length - 1;

  const finish = (guide = false) => {
    if (pending) return;
    start(async () => {
      try {
        await finishWelcomeAction();
        setOpen(false);
        if (guide) router.push("/guide");
      } catch {
        setFailed(true);
      }
    });
  };

  useEffect(() => {
    const modal = dialog.current;
    if (!open || !modal) return;
    const previous = document.activeElement;
    modal.showModal();
    return () => {
      modal.close();
      const target = previous instanceof HTMLElement && previous !== document.body && previous.isConnected
        ? previous : document.getElementById("student-content");
      target?.focus({ preventScroll: true });
    };
  }, [open]);

  // Back on the first slide and the guide link on earlier slides leave the tab order.
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (modal?.open && !modal.contains(document.activeElement)) modal.querySelector("button")?.focus();
  }, [index]);

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      aria-label={t.title}
      onCancel={(event) => { event.preventDefault(); finish(); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          setIndex((i) => Math.max(0, Math.min(i + direction, t.slides.length - 1)));
        }
        if (event.key === "Tab") {
          const items = event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]");
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}
      className="card fixed inset-x-0 inset-y-auto bottom-3 mx-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-md animate-pop overflow-y-auto p-0 sm:inset-y-0 sm:my-auto backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
    >
      <div className="relative bg-gradient-to-br from-brand-600 to-brand-500 px-6 pb-8 pt-6 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10" />
        <button type="button" onClick={() => finish()} className="absolute right-3 top-3 z-10 rounded-full px-2.5 py-1 text-xs font-medium text-white/85 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white">
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
        <div className="mt-4 flex flex-wrap items-center gap-3">
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
              <button type="button" className="btn-primary" onClick={() => finish()}>{pending ? messages.common.status.saving : t.done}</button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setIndex(index + 1)}>{t.next}</button>
            )}
          </div>
        </div>
        {last && (
          <Link href="/guide" onClick={(event) => { event.preventDefault(); finish(true); }} className="mt-3 block text-center text-sm font-medium text-brand-700 hover:underline">
            🎓 {t.openGuide} →
          </Link>
        )}
        {failed && <p role="alert" className="mt-2 text-sm text-red-700">{messages.common.status.somethingWrong}</p>}
      </div>
    </dialog>
  );
}
