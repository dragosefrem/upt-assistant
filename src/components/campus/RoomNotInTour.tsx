"use client";

import { useT } from "@/i18n/client";
import { Mascot } from "../Mascot";
import { GetThere } from "./GetThere";

/** Where the timetable places a room the tour does not know. */
export interface KnownPlace {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** The position on the map is approximate. */
  approximate: boolean;
  /** The building is a guess: the student's own faculty. */
  guessed?: boolean;
}

/**
 * A room from the student's timetable that the tour has no record of. Instead of a dead end,
 * say so plainly and lead to the building the timetable places it in, without pretending to
 * know where the room is inside.
 */
export function RoomNotInTour({ room, place, at, mapsKey }: {
  room: string;
  place: KnownPlace | null;
  /** Start of the class, "HH:MM", to say when to leave. */
  at: string | null;
  mapsKey: string | null;
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
          {place?.approximate && !place.guessed && <p className="mt-1 text-xs text-slate-500">{t.approximate}</p>}
        </div>
      </div>
      {place && (
        <div className="mt-4">
          <GetThere
            entrance={{ name: place.name, pin: { lat: place.lat, lon: place.lng, name: place.address ?? "" } }}
            at={at}
            mapsKey={mapsKey}
            building
          />
        </div>
      )}
    </section>
  );
}
