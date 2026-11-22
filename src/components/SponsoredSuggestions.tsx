"use client";

import { CalendarCheck2, CalendarPlus, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import type { SponsoredOffer } from "@/lib/sponsored-events";
import { formatTimeSlot } from "@/lib/time";
import { SponsoredCard } from "./SponsoredCard";

export function SponsoredSuggestions({ offers, homeWeek, onChange, onPickDay }: {
  offers: SponsoredOffer[]; homeWeek: boolean; onChange: () => void; onPickDay: (date: string) => void;
}) {
  const { sponsored: t, common } = useT();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ offer: SponsoredOffer; choice: "save" | "hide" } | null>(null);
  const [error, setError] = useState("");

  async function respond(offer: SponsoredOffer, choice: "save" | "hide" | "undoHide") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/schedule", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sponsored", id: offer.id, choice }) });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? common.status.somethingWrong);
        if (res.status === 409) onChange();
        return;
      }
      setNotice(choice === "undoHide" ? null : { offer, choice });
      onChange();
    } catch { setError(common.status.offline); }
    finally { setBusy(false); }
  }

  if (!offers.length && !notice && !error) return null;
  return (
    <section aria-label={t.fits} className="space-y-2.5 border-b border-cyan-900/15 bg-[#eef7f6] px-4 py-3">
      {offers.length > 0 && <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-cyan-950"><CalendarCheck2 size={17} aria-hidden />{t.fits}</h2>
          {homeWeek && <span className="text-xs text-slate-600">{t.nextTwoWeeks}</span>}
        </div>
        <div className="grid gap-3">
          {(expanded ? offers : offers.slice(0, 1)).map((e) => (
            <SponsoredCard key={e.id} {...e} time={formatTimeSlot(e.startMin, e.endMin)}>
              <button type="button" disabled={busy} className="btn min-h-9 px-2 text-cyan-900 hover:bg-cyan-50" onClick={() => void respond(e, "save")}>
                <CalendarPlus size={16} aria-hidden />{t.add}
              </button>
              <button type="button" disabled={busy} className="btn-ghost ml-auto min-h-9 px-2 text-xs @xl:mx-auto" onClick={() => void respond(e, "hide")}>{t.hide}</button>
            </SponsoredCard>
          ))}
        </div>
        {offers.length > 1 && <button type="button" className="btn-ghost min-h-9 px-1 text-xs" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t.less : t.more(offers.length - 1)}<ChevronDown size={14} aria-hidden className={expanded ? "rotate-180" : ""} />
        </button>}
      </>}
      {notice && <div className="flex flex-wrap items-center gap-x-2 text-sm text-cyan-950">
        <p role="status">{notice.choice === "save" ? t.added(notice.offer.title) : t.hidden}</p>
        {notice.choice === "hide"
          ? <button type="button" disabled={busy} className="btn-ghost min-h-9 px-2 underline" onClick={() => void respond(notice.offer, "undoHide")}>{common.actions.undo}</button>
          : <button type="button" className="btn-ghost min-h-9 px-2 underline" onClick={() => { onPickDay(notice.offer.date); setNotice(null); }}>{t.viewDay}</button>}
        <button type="button" className="btn-ghost ml-auto min-h-9 px-2" aria-label={common.actions.close} onClick={() => setNotice(null)}><X size={15} aria-hidden /></button>
      </div>}
      {error && <div className="flex items-center gap-2 text-sm text-red-800"><p role="alert">{error}</p>
        <button type="button" className="btn-ghost ml-auto min-h-9 px-2" aria-label={common.actions.close} onClick={() => setError("")}><X size={15} aria-hidden /></button></div>}
    </section>
  );
}
