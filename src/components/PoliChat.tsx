"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Assistant } from "./Assistant";
import { ASK_ASSISTANT, MASCOT_HAPPY_SRC } from "./Mascot";
import { burstFrom, OPEN_CHAT } from "./poliFx";

/**
 * Poli as the chat button: a floating robot in the corner that opens the assistant.
 * Pressing it makes Poli jump, close its eyes happily and throw a few hearts and stars.
 * The assistant stays mounted while closed, so questions from the quick buttons still reach it.
 */
export function PoliChat() {
  const t = useT().calendar.poli;
  const [open, setOpen] = useState(false);
  const [boop, setBoop] = useState(false);
  const [blink, setBlink] = useState(false);
  const [hello, setHello] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const boopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const burst = useCallback(() => {
    if (button.current) burstFrom(button.current);
  }, []);

  const press = () => {
    setBoop(false);
    // Restart the jump on the next frame so quick double presses replay it.
    requestAnimationFrame(() => setBoop(true));
    if (boopTimer.current) clearTimeout(boopTimer.current);
    boopTimer.current = setTimeout(() => setBoop(false), 750);
    burst();
    setHello(false);
    setOpen((o) => !o);
  };

  useEffect(() => {
    // A quick button elsewhere on the page asked something: show the chat.
    const onAsk = () => {
      setHello(false);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) setOpen(false);
    };
    window.addEventListener(ASK_ASSISTANT, onAsk);
    // Any other Poli on the page was pressed.
    window.addEventListener(OPEN_CHAT, onAsk);
    // Load the happy face early so the first jump does not flicker.
    new Image().src = MASCOT_HAPPY_SRC;
    window.addEventListener("keydown", onKey);
    // Poli blinks now and then and says hello once.
    const blinker = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 4200);
    const hi = setTimeout(() => setHello(true), 1200);
    const bye = setTimeout(() => setHello(false), 6500);
    return () => {
      window.removeEventListener(ASK_ASSISTANT, onAsk);
      window.removeEventListener(OPEN_CHAT, onAsk);
      window.removeEventListener("keydown", onKey);
      clearInterval(blinker);
      clearTimeout(hi);
      clearTimeout(bye);
      if (boopTimer.current) clearTimeout(boopTimer.current);
    };
  }, []);

  const happy = boop || blink;

  return (
    <>
      <div
        id="poli-chat"
        className={`poli-panel fixed inset-x-2 bottom-28 z-50 h-[min(70vh,calc(100dvh-9rem))] sm:inset-x-auto sm:right-6 sm:w-[24rem] sm:h-[min(36rem,calc(100dvh-10rem))] ${open ? "poli-open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        <Assistant onClose={() => setOpen(false)} />
      </div>

      <p className={`poli-speech fixed bottom-12 right-[7.5rem] z-50 ${hello && !open ? "poli-show" : ""}`} aria-hidden>
        {t.hello}
      </p>

      <button
        ref={button}
        onClick={press}
        className={`poli-fab fixed bottom-6 right-6 z-[55] ${boop ? "poli-boop" : ""} ${open ? "poli-is-open" : ""}`}
        aria-label={open ? t.closeChat : t.chat}
        aria-expanded={open}
        aria-controls="poli-chat"
      >
        <span className="poli-ring" />
        <svg className="poli-bot" viewBox="0 0 120 120" aria-hidden>
          <line x1="60" y1="22" x2="60" y2="10" stroke="#1f48c4" strokeWidth="4" strokeLinecap="round" />
          <circle className="poli-ball" cx="60" cy="9" r="6" fill={boop ? "#f472b6" : "#fbbf24"} />
          <rect x="18" y="22" width="84" height="72" rx="30" fill="#2f5fe0" />
          <rect x="28" y="34" width="64" height="44" rx="20" fill="#eef4ff" />
          {happy ? (
            <g fill="none" stroke="#142457" strokeWidth="4" strokeLinecap="round">
              <path d="M39 56 Q46 47 53 56" />
              <path d="M67 56 Q74 47 81 56" />
            </g>
          ) : (
            <g>
              <circle cx="46" cy="54" r="7" fill="#142457" />
              <circle cx="74" cy="54" r="7" fill="#142457" />
              <circle cx="48.5" cy="51.5" r="2.2" fill="#fff" />
              <circle cx="76.5" cy="51.5" r="2.2" fill="#fff" />
            </g>
          )}
          <path d="M50 66 Q60 74 70 66" fill="none" stroke="#142457" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="36" cy="66" r="4" fill="#fda4af" opacity=".8" />
          <circle cx="84" cy="66" r="4" fill="#fda4af" opacity=".8" />
          <rect x="10" y="50" width="10" height="20" rx="5" fill="#1f48c4" />
          <rect className="poli-wave" x="100" y="50" width="10" height="20" rx="5" fill="#1f48c4" />
          <rect x="40" y="94" width="40" height="16" rx="8" fill="#1f48c4" />
          <text x="60" y="106" textAnchor="middle" fontFamily="sans-serif" fontSize="10" fontWeight="700" fill="#fff">UPT</text>
        </svg>
        <span className="poli-badge" aria-hidden>✕</span>
      </button>
    </>
  );
}
