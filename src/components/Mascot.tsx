/* eslint-disable @next/next/no-img-element -- a small static picture; next/image adds nothing here */

/**
 * Poli, the app's mascot. The file in public/images is a placeholder: swap in the
 * picture generated with ChatGPT or Gemini (see docs/IMAGINI.md) by replacing the file
 * or changing this path.
 */
export const MASCOT_SRC = "/images/mascot.svg";

export function Mascot({ size = 40, className = "", wave = false }: { size?: number; className?: string; wave?: boolean }) {
  return (
    <img
      src={MASCOT_SRC}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={`shrink-0 select-none ${wave ? "animate-wiggle" : ""} ${className}`}
      draggable={false}
    />
  );
}

/** Lets any part of the page ask the assistant a question (quick actions, empty states). */
export const ASK_ASSISTANT = "upt:ask-assistant";

export function askAssistant(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_ASSISTANT, { detail: question }));
}
