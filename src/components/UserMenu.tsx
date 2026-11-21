"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { useT } from "@/i18n/client";
import { LanguageSwitch } from "./LanguageSwitch";

/** The avatar in the header: settings, admin, language and sign out. */
export function UserMenu({ name, email, admin }: { name: string; email: string; admin: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500";
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.common.nav.menu}
        title={name}
        className="flex items-center gap-2 rounded-full p-0.5 pr-1 text-sm text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:pr-3"
      >
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="hidden max-w-[10rem] truncate md:inline">{name}</span>
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-full z-40 mt-2 w-64 animate-pop p-2 shadow-[0_18px_40px_-12px_rgba(20,36,87,0.35)]">
          <div className="border-b border-slate-100 px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">{email}</p>
          </div>
          <div className="py-1">
            <Link role="menuitem" href="/settings" className={item} onClick={() => setOpen(false)}>
              <span aria-hidden>⚙️</span>
              {t.common.nav.settings}
            </Link>
            {admin && (
              <Link role="menuitem" href="/admin" className={item} onClick={() => setOpen(false)}>
                <span aria-hidden>🛠️</span>
                {t.common.nav.admin}
              </Link>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <span className="text-sm text-slate-600">{t.common.nav.language}</span>
            <LanguageSwitch />
          </div>
          <form action={logoutAction} className="border-t border-slate-100 pt-1">
            <button role="menuitem" className={item}>
              <span aria-hidden>👋</span>
              {t.common.nav.signOut}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
