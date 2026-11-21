"use client";

/* eslint-disable @next/next/no-img-element -- small previews hosted by the UPT tour; next/image would need a remote pattern for nothing */
import { useState } from "react";

/** A panorama preview from the tour, or a pin when there is none or it fails to load. */
export function Thumb({ src, className = "h-12 w-16" }: { src: string | null | undefined; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-50 text-brand-500 ${className}`}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="text-lg">📍</span>
      )}
    </span>
  );
}
