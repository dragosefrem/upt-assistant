"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

export function ShareInvitation({ path, personal = false }: { path: string; personal?: boolean }) {
  const t = useT().contacts.share;
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  return (
    <section className="space-y-2 border-t border-slate-200 pt-4">
      <h2 className="font-semibold">{personal ? t.personalHeading : t.guestHeading}</h2>
      <p className="text-sm text-slate-600">{personal ? t.personalText : t.guestText}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          try { await navigator.clipboard.writeText(url); setCopied(true); }
          catch { setManual(url); }
        }}>{personal ? t.copyPersonal : t.copyGuest}</button>
        {!personal && <a href={path} className="btn-ghost">{t.open}</a>}
        {copied && <span role="status" className="text-sm text-teal-800">{t.copied}</span>}
      </div>
      {manual && <input className="field" aria-label={t.linkToCopy} readOnly onFocus={(e) => e.target.select()} value={manual} />}
    </section>
  );
}
