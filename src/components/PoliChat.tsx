"use client";

import { MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Assistant } from "./Assistant";
import { ASK_ASSISTANT } from "./Mascot";
import { OPEN_CHAT } from "./poliFx";

export function PoliChat() {
  const t = useT().calendar.poli;
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panel.current?.contains(active)) opener.current = active;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    window.addEventListener(ASK_ASSISTANT, show);
    window.addEventListener(OPEN_CHAT, show);
    return () => {
      window.removeEventListener(ASK_ASSISTANT, show);
      window.removeEventListener(OPEN_CHAT, show);
    };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open], [role=dialog]")) close();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open, close]);

  return (
    <>
      <div id="poli-chat" ref={panel} tabIndex={-1} role="region" aria-label={t.chat}
        className={`poli-panel fixed inset-x-2 bottom-2 z-50 h-[min(82dvh,calc(100dvh-5rem))] sm:inset-x-auto sm:right-5 sm:w-96 lg:bottom-20 lg:h-[min(36rem,calc(100dvh-7rem))] ${open ? "poli-open" : ""}`}
        aria-hidden={!open} inert={!open}>
        <Assistant onClose={close} />
      </div>
      <button type="button" onClick={open ? close : show} aria-controls="poli-chat" aria-expanded={open} aria-label={open ? t.closeChat : t.chat}
        className="fixed right-5 bottom-5 z-40 hidden items-center gap-2 rounded-full bg-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-900 lg:inline-flex">
        {open ? <X size={18} aria-hidden /> : <MessageCircle size={18} aria-hidden />} Poli
      </button>
    </>
  );
}
