"use client";

import { useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { Directions } from "@/lib/directions";
import { formatMinutes } from "@/lib/time";
import { useLocation } from "./LocationProvider";

/** Travel suggestions from the student's position to the building of `room`. */
export function TripSuggestions({ room, startMin, compact = false }: { room: string | null; startMin?: number; compact?: boolean }) {
  const t = useT().calendar.trip;
  // The route's labels and summary come back in the interface language; refetch when it changes.
  const locale = useLocale();
  const { position, status, enable } = useLocation();
  const [trip, setTrip] = useState<Directions | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-query only when the student has moved noticeably (~100 m), not on every GPS jitter.
  const lat = position ? position.lat.toFixed(3) : null;
  const lng = position ? position.lng.toFixed(3) : null;

  useEffect(() => {
    if (!lat || !lng) return;
    let cancelled = false;
    fetch(`/api/directions?lat=${lat}&lng=${lng}&room=${encodeURIComponent(room ?? "")}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setTrip(data.trip);
          setError(null);
        } else {
          setTrip(null);
          setError(data.error ?? t.unavailable);
        }
      })
      .catch(() => !cancelled && setError(t.loadFailed));
    return () => {
      cancelled = true;
    };
  }, [lat, lng, room, locale, t]);

  if (!position) {
    return (
      <div className={compact ? "text-xs text-slate-500" : "rounded-lg bg-slate-50 p-3 text-sm text-slate-600"}>
        {status === "denied" ? (
          t.blocked
        ) : status === "unsupported" ? (
          t.unsupported
        ) : (
          <button className={compact ? "font-medium text-brand-600 hover:underline" : "btn-secondary"} onClick={enable}>
            {status === "asking" ? t.waiting : t.enable}
          </button>
        )}
      </div>
    );
  }
  if (error) return <p className="text-xs text-slate-500">{error}</p>;
  if (!trip) return <p className="text-xs text-slate-400">{t.working}</p>;

  const leaveBy = startMin !== undefined && trip.leaveMinutesBefore > 0 ? formatMinutes(Math.max(0, startMin - trip.leaveMinutesBefore)) : null;
  if (compact) {
    return (
      <p className="text-xs text-slate-600">
        {trip.summary}
        {leaveBy && <span className="font-medium text-slate-900"> {t.leaveBy(leaveBy)}</span>}{" "}
        <a className="font-medium text-brand-600 hover:underline" href={trip.options[0].mapsUrl} target="_blank" rel="noreferrer">{t.openMap}</a>
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-sm">
      <p className="text-slate-700">
        {trip.summary}
        {leaveBy && <span className="font-medium text-slate-900"> {t.leaveByOnTime(leaveBy)}</span>}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {trip.options.map((o) => (
          <li key={o.mode}>
            <a className="btn-secondary px-2.5 py-1 text-xs" href={o.mapsUrl} target="_blank" rel="noreferrer">
              {o.label} · ~{o.minutes} min ↗
            </a>
          </li>
        ))}
      </ul>
      {trip.approximate && <p className="mt-2 text-xs text-slate-500">{t.approximate}</p>}
    </div>
  );
}
