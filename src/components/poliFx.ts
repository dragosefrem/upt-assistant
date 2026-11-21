/** Small effects shared by every Poli on the page. Browser-only. */

/** Fired on `window` when any Poli is pressed: the chat opens. */
export const OPEN_CHAT = "upt:open-chat";

const BITS = ["💙", "✨", "⭐", "💛", "✨", "💙", "🎉"];

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Throws a few hearts and stars out of `el`, fanned above it. */
export function burstFrom(el: Element, scale = 1) {
  if (prefersReducedMotion()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  BITS.forEach((emoji, i) => {
    const angle = ((-160 + (i * 140) / (BITS.length - 1)) * Math.PI) / 180;
    const dist = (50 + Math.random() * 30) * scale;
    const bit = document.createElement("span");
    bit.className = "poli-burst";
    bit.textContent = emoji;
    bit.style.left = `${cx - 9}px`;
    bit.style.top = `${cy - 12}px`;
    bit.style.fontSize = `${Math.round(12 + 6 * scale)}px`;
    bit.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    bit.style.setProperty("--r", `${(Math.random() - 0.5) * 60}deg`);
    bit.style.animationDelay = `${i * 30}ms`;
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 1200);
  });
}
