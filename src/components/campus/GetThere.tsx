"use client";

import { useMemo, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { planTrip, type TravelOption } from "@/lib/directions";
import { metresBetween } from "@/lib/campuspath/links";
import { leaveBy, mapsDirectionsUrl, mapsEmbedUrl, TRAVEL_MODES, type TravelMode } from "@/lib/campuspath/maps";
import type { Pin } from "@/lib/campuspath/types";
import { useLocation } from "../LocationProvider";

/** A building entrance of the tour, or a whole building when the tour does not know the room. */
interface Entrance {
  name: string;
  area?: string;
  pin: Pin;
}

/** Within this many metres of the pin the student is at the entrance already. */
const HERE_METRES = 60;
const TRIP_MODE: Record<TravelMode, TravelOption["mode"]> = { walking: "walk", bicycling: "bike", transit: "transit", driving: "drive" };

/**
 * Leg 1 of the journey: from where the student is to the building entrance, on an embedded
 * Google map, with travel times and when to leave. The position is used only once shared.
 */
export function GetThere({
  entrance,
  at,
  mapsKey,
  building = false,
}: {
  entrance: Entrance;
  /** Start of the class, "HH:MM", to say when to leave. */
  at: string | null;
  mapsKey: string | null;
  /** The map leads to a building as a whole: there is no walk inside to follow afterwards. */
  building?: boolean;
}) {
  const messages = useT();
  const t = messages.campus.journey;
  const locale = useLocale();
  const { position, status, enable } = useLocation();
  const [mode, setMode] = useState<TravelMode>("walking");
  const target = { lat: entrance.pin.lat, lng: entrance.pin.lon };
  // Rounded to ~100 m, so the map does not reload on every GPS jitter.
  const lat = position ? Math.round(position.lat * 1000) / 1000 : null;
  const lng = position ? Math.round(position.lng * 1000) / 1000 : null;
  const origin = useMemo(() => (lat !== null && lng !== null ? { lat, lng } : null), [lat, lng]);
  const distance = position ? metresBetween({ lat: position.lat, lon: position.lng }, entrance.pin) : null;
  const here = distance !== null && distance < HERE_METRES;
  const trip = useMemo(
    () => (origin ? planTrip(origin, { name: entrance.name, address: null, lat: target.lat, lng: target.lng, approximate: false }, locale, true) : null),
    [origin, entrance.name, target.lat, target.lng, locale],
  );
  const minutesFor = (m: TravelMode) => trip?.options.find((o) => o.mode === TRIP_MODE[m])?.minutes ?? null;
  const minutes = minutesFor(mode);
  const leave = at && minutes !== null ? leaveBy(at, minutes + 5) : null;
  const mapsLink = mapsDirectionsUrl({ origin, destination: target, mode });
  // The building's name on the campus map, else the tour's area; not when it repeats the entrance's name.
  const where = [entrance.pin.name, entrance.area].find((v) => v && v !== entrance.name) ?? "";

  if (here) {
    return (
      <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
        <span aria-hidden>✅</span>
        <span className="min-w-0 flex-1">{building ? messages.campus.lost.here(entrance.name) : t.youAreAt(entrance.name)}</span>
        {!building && (
          <a href="#campus-leg2" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            {t.nextInside} ↓
          </a>
        )}
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <iframe
        key={`${origin ? `${origin.lat},${origin.lng}` : "place"}-${mode}`}
        title={origin ? t.mapTitle(entrance.name) : t.placeTitle(entrance.name)}
        src={mapsEmbedUrl({ destination: target, origin, mode, key: mapsKey, locale })}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        className="aspect-[4/3] w-full rounded-2xl border border-slate-200 bg-slate-100 md:aspect-auto md:min-h-[18rem]"
      />
      <div className="min-w-0 space-y-3">
        <div>
          <p className="font-semibold text-slate-900">{t.entrance(entrance.name)}</p>
          {where && <p className="text-sm text-slate-600">{where}</p>}
          <p className="mt-1 text-xs text-slate-500">{building ? messages.campus.lost.mapHint : t.entranceHint}</p>
        </div>
        {origin ? (
          <>
            {trip && <p className="text-sm text-slate-700">{trip.summary}</p>}
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-slate-600">{t.mode}</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {TRAVEL_MODES.map((m) => {
                  const n = minutesFor(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-xl px-2.5 py-2 text-left text-xs ring-1 transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
                        mode === m ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block font-semibold">{t.modes[m]}</span>
                      {n !== null && <span className={mode === m ? "text-white/85" : "text-slate-500"}>{t.minutes(n)}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {leave && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                <span aria-hidden>⏰ </span>
                {t.leaveBy(leave)}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-1.5">
            {status === "denied" ? (
              <p className="text-sm text-slate-600">{t.declined}</p>
            ) : status === "unsupported" ? (
              <p className="text-sm text-slate-600">{t.unsupported}</p>
            ) : (
              <button type="button" className="btn-secondary w-full" onClick={enable} disabled={status === "asking"}>
                <span aria-hidden>📍</span> {status === "asking" ? t.waiting : t.shareLocation}
              </button>
            )}
            <p className="text-xs text-slate-500">{t.privacy}</p>
          </div>
        )}
        <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="btn-primary w-full">
          <span aria-hidden>🗺️</span> {t.openInMaps} ↗
        </a>
      </div>
    </div>
  );
}
