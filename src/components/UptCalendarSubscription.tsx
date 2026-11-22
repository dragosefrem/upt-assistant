"use client";

import { Check, ExternalLink, Landmark, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "@/i18n/client";

export function UptCalendarSubscription({ subscribed, matches, onChange }: {
  subscribed: boolean;
  matches: number | null;
  onChange: (subscribed: boolean) => void;
}) {
  const t = useT().calendar.subscription;
  const hint = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState("");

  async function toggle() {
    const next = !subscribed;
    setPending(true);
    setError(false);
    setNotice("");
    try {
      const response = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "uptSubscription", subscribed: next }) });
      if (!response.ok) { setError(true); return; }
      onChange(next);
      setNotice(next ? t.enabled : t.disabled);
    } catch { setError(true); }
    finally { setPending(false); }
  }

  return (
    <section className="upt-subscription" data-subscribed={subscribed} aria-label={t.name}>
      <span className="upt-subscription-icon" aria-hidden><Landmark size={20} strokeWidth={1.75} /></span>
      <h3 className="upt-subscription-title text-sm font-semibold tracking-tight text-indigo-950">{t.name}</h3>
      <p id={hint} className="upt-subscription-hint text-xs leading-relaxed text-slate-600">
        {subscribed && matches !== null ? (matches ? t.matches(matches) : t.empty) : t.intro}
        {subscribed && matches === 0 && <>{" "}<a href="https://www.upt.ro/evenimente" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-indigo-800 underline underline-offset-2">
          {t.browse}<ExternalLink size={12} aria-hidden />
        </a></>}
      </p>
      <button type="button" role="switch" aria-checked={subscribed} aria-label={t.name} aria-describedby={hint}
        title={subscribed ? t.unsubscribe : t.subscribe} aria-busy={pending} disabled={pending}
        onClick={() => void toggle()} className="upt-subscription-toggle">
        <span aria-hidden className="upt-switch-track"><span className="upt-switch-thumb">
          {subscribed && <Check size={10} strokeWidth={3} />}
        </span></span>
        {pending ? <><LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />{t.updating}</>
          : subscribed ? t.subscribed : t.subscribe}
      </button>
      {error && <p role="alert" className="col-span-full text-sm text-red-700">{t.failed}</p>}
      <span role="status" className="sr-only">{notice}</span>
    </section>
  );
}
