"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/actions/locale";
import { useLocale, useT } from "@/i18n/client";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/config";

/** RO | EN toggle. `tone="dark"` suits a coloured background (landing hero). */
export function LanguageSwitch({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale) return;
    start(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  };

  const frame = tone === "dark" ? "border-white/30 bg-white/10" : "border-slate-200 bg-white";
  const idle = tone === "dark" ? "text-white/80 hover:text-white" : "text-slate-600 hover:text-slate-900";
  const active = tone === "dark" ? "bg-white text-brand-700" : "bg-brand-600 text-white";
  return (
    <div role="group" aria-label={t.common.nav.language} className={`inline-flex shrink-0 rounded-full border p-0.5 text-xs font-semibold ${frame} ${pending ? "opacity-60" : ""} ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          title={LOCALE_NAMES[l]}
          aria-label={LOCALE_NAMES[l]}
          aria-pressed={l === locale}
          disabled={pending}
          onClick={() => choose(l)}
          className={`rounded-full px-2.5 py-1 uppercase transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${l === locale ? active : idle}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
