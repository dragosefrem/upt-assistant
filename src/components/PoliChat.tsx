"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Assistant } from "./Assistant";
import { ASK_ASSISTANT, MASCOT_HAPPY_SRC, MASCOT_SRC } from "./Mascot";
import { burstFrom, OPEN_CHAT } from "./poliFx";

export function PoliChat() {
  const t = useT().calendar.poli;
  const [open, setOpen] = useState(false);
  const [happy, setHappy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
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

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    burstFrom(event.currentTarget, .8);
    setHappy(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHappy(false), 700);
    if (open) close();
    else show();
  };

  return (
    <>
      <div id="poli-chat" ref={panel} tabIndex={-1} role="region" aria-label={t.chat}
        className={`poli-panel poli-chat-position ${open ? "poli-open" : ""}`}
        aria-hidden={!open} inert={!open}>
        <Assistant onClose={close} />
      </div>
      <button type="button" onClick={toggle} aria-controls="poli-chat" aria-expanded={open}
        aria-label={open ? t.closeChat : t.chat} title={open ? t.closeChat : t.chat}
        className={`poli-launcher ${open ? "is-open" : ""}`}>
        <Image unoptimized src={happy ? MASCOT_HAPPY_SRC : MASCOT_SRC} alt="" width={70} height={70} className={happy ? "poli-jump" : ""} />
        <span className="poli-close-badge" aria-hidden><X size={17} strokeWidth={2.5} /></span>
      </button>
    </>
  );
}
