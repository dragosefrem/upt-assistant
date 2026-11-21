"use client";

/* eslint-disable @next/next/no-img-element -- a small static picture; next/image adds nothing here */
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { burstFrom, OPEN_CHAT } from "./poliFx";

/**
 * Poli, the app's mascot. The files in public/images are placeholders: swap in the
 * pictures generated with ChatGPT or Gemini (see docs/IMAGINI.md) by replacing the
 * files or changing these paths. The happy one shows while Poli jumps.
 */
export const MASCOT_SRC = "/images/mascot.svg";
export const MASCOT_HAPPY_SRC = "/images/mascot-happy.svg";

/**
 * Every Poli is a button: pressing it makes Poli jump, close its eyes happily and throw
 * hearts and stars, then opens the chat. Pass `chat={false}` where there is no chat.
 */
export function Mascot({
  size = 40,
  className = "",
  wave = false,
  chat = true,
}: {
  size?: number;
  className?: string;
  wave?: boolean;
  chat?: boolean;
}) {
  const t = useT().calendar.poli;
  const [jump, setJump] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const press = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setJump(false);
    const el = e.currentTarget;
    // Restart the jump on the next frame so quick presses replay it.
    requestAnimationFrame(() => setJump(true));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setJump(false), 750);
    burstFrom(el, Math.min(1, Math.max(0.6, size / 60)));
    if (chat) window.dispatchEvent(new Event(OPEN_CHAT));
  };

  return (
    <button
      type="button"
      onClick={press}
      className={`poli-hit inline-flex shrink-0 rounded-full ${className}`}
      aria-label={chat ? t.chat : "Poli"}
      title={chat ? t.chat : undefined}
    >
      <img
        src={jump ? MASCOT_HAPPY_SRC : MASCOT_SRC}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className={`select-none ${jump ? "poli-jump" : wave ? "animate-wiggle" : ""}`}
        draggable={false}
      />
    </button>
  );
}

/** Lets any part of the page ask the assistant a question (quick actions, empty states). */
export const ASK_ASSISTANT = "upt:ask-assistant";

export function askAssistant(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_ASSISTANT, { detail: question }));
}
