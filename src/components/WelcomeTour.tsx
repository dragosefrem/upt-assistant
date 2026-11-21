"use client";

import { ArrowRight, BookOpen, Compass } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { finishWelcomeAction } from "@/app/onboarding/actions";
import { useT } from "@/i18n/client";
import { Modal } from "./Modal";

/** Optional orientation on the first calendar. Finishing it is remembered on the account. */
export function WelcomeTour({ name }: { name: string }) {
  const messages = useT();
  const t = messages.onboarding.tour;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [index, setIndex] = useState(0);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const next = useRef<HTMLButtonElement>(null);
  const slide = t.slides[index];
  const last = index === t.slides.length - 1;

  const finish = (guide = false) => {
    start(async () => {
      try {
        await finishWelcomeAction();
        setFinished(true);
        if (guide) router.push("/guide");
        else document.getElementById("student-content")?.focus({ preventScroll: true });
      } catch {
        setFailed(true);
      }
    });
  };

  if (finished) return null;
  return (
    <>
      <button type="button" className="btn-ghost text-brand-700" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Compass size={16} aria-hidden />{t.title}
      </button>
      {open && <Modal open title={t.title} onClose={() => setOpen(false)}>
        <div className="pt-2">
          <div key={index} className="agenda-enter" aria-live="polite" aria-atomic="true">
            <p className="text-xs text-slate-600">{t.progress(index + 1, t.slides.length)}</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight">{slide.title(name.split(/\s+/)[0] || name)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{slide.body}</p>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {index > 0 && <button type="button" className="btn-ghost" onClick={() => { setIndex(index - 1); next.current?.focus(); }}>{t.back}</button>}
            <button ref={next} type="button" disabled={pending} className="btn-primary" onClick={() => last ? finish() : setIndex(index + 1)}>
              {pending ? messages.common.status.saving : last ? t.done : t.next}<ArrowRight size={16} aria-hidden />
            </button>
          </div>
          {last && <button type="button" disabled={pending} className="btn-ghost mt-2 w-full text-brand-700" onClick={() => finish(true)}><BookOpen size={16} aria-hidden />{t.openGuide}</button>}
          {failed && <p role="alert" className="mt-2 text-sm text-red-700">{messages.common.status.somethingWrong}</p>}
        </div>
      </Modal>}
    </>
  );
}
