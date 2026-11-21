"use client";

import { useEffect, useId, useRef } from "react";
import { useT } from "@/i18n/client";

/**
 * A modal sheet on the native <dialog>: focus moves in and back, Escape closes it and the page
 * behind is inert. Slides up from the bottom on phones, centred on wider screens.
 */
export function Modal({
  open = true,
  title,
  onClose,
  children,
  wide = false,
}: {
  open?: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onMouseDown={(e) => {
        // A press on the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`fixed inset-x-0 bottom-0 top-auto m-0 flex max-h-[92dvh] w-full max-w-none flex-col overflow-hidden rounded-t-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 open:motion-safe:animate-pop sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:rounded-3xl ${
        wide ? "sm:max-w-3xl" : "sm:max-w-lg"
      } [&:not([open])]:hidden`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 id={titleId} className="text-base font-semibold text-slate-900 sm:text-lg">
          {title}
        </h2>
        <button type="button" className="btn-ghost -mr-2 px-2.5" onClick={onClose} aria-label={t.common.actions.close} title={t.common.actions.close}>
          <span aria-hidden>✕</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-3 sm:px-5">{children}</div>
    </dialog>
  );
}
