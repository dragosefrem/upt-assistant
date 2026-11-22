"use client";

import { useT } from "@/i18n/client";
import type { Place } from "@/lib/schedule";
import { Mascot } from "../Mascot";
import { GetThere } from "./GetThere";

/**
 * A room from the student's timetable that the tour has no record of. Instead of a dead end,
 * say so plainly and lead to the building the timetable places it in, without pretending to
 * know where the room is inside.
 */
export function RoomNotInTour({ room, place, at, mapsKey, map = true }: {
  room: string;
  /** Where the timetable places the room; null when no building is known. */
  place: Place | null;
  /** Start of the class, "HH:MM", to say when to leave. */
  at: string | null;
  mapsKey: string | null;
  /** False when the journey around this card already shows the building on a map. */
  map?: boolean;
}) {
  const t = useT().campus.lost;
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="campus-lost-title">
      <div className="flex items-start gap-3">
        <Mascot size={44} />
        <div className="min-w-0 flex-1">
          <h2 id="campus-lost-title" className="break-words font-semibold text-slate-900">{t.title(room)}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            {!place ? t.nowhere : place.guessed ? t.guessed(place.name) : t.known(place.name, place.address)}
          </p>
        </div>
      </div>
      {place && map && (
        <div className="mt-4">
          <GetThere place={place} startsWalkthrough={false} at={at} mapsKey={mapsKey} />
        </div>
      )}
    </section>
  );
}
