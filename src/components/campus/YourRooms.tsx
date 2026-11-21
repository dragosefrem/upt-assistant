"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import type { TimetableRoom } from "@/lib/campuspath/rooms";
import { Mascot } from "../Mascot";

/** The rooms this student has classes in, each one tap away from a walkthrough. */
export function YourRooms({
  rooms,
  hasSemester,
  busyRoom,
  onGo,
}: {
  rooms: TimetableRoom[];
  hasSemester: boolean;
  /** The room whose route is being planned. */
  busyRoom: string | null;
  onGo: (room: TimetableRoom) => void;
}) {
  const t = useT().campus;
  return (
    <section aria-labelledby="campus-rooms-title" className="card p-4 sm:p-5">
      <h2 id="campus-rooms-title" className="text-lg font-semibold text-slate-900">
        <span aria-hidden>🏫 </span>
        {t.rooms.title}
      </h2>
      {rooms.length ? (
        <>
          <p className="mt-0.5 text-sm text-slate-600">{t.rooms.lead}</p>
          {/* A swipeable row on phones, a grid on wider screens. */}
          <ul
            aria-label={t.rooms.listLabel}
            className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4"
          >
            {rooms.map((room) => (
              <li
                key={room.room}
                className="flex w-[15.5rem] shrink-0 snap-start flex-col rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-brand-50/40 p-3 sm:w-auto"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-bold tracking-tight text-slate-900">{room.room}</span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{t.rooms.classes(room.classes)}</span>
                </div>
                <p className="truncate text-xs text-slate-500" title={room.building ?? undefined}>
                  {room.building ? (room.approximate ? t.rooms.approximate(room.building) : room.building) : t.rooms.unknownBuilding}
                </p>
                <ul className="mt-2 flex-1 space-y-0.5 text-sm text-slate-700">
                  {room.courses.slice(0, 3).map((course) => (
                    <li key={course.title} className="line-clamp-2">
                      {course.title} <span className="text-xs text-slate-500">· {course.kinds.join(", ")}</span>
                    </li>
                  ))}
                  {room.courses.length > 3 && <li className="text-xs text-slate-500">+{room.courses.length - 3}</li>}
                </ul>
                <button
                  type="button"
                  className="btn-primary mt-3 w-full"
                  onClick={() => onGo(room)}
                  disabled={busyRoom === room.room}
                  aria-label={t.rooms.showWayTo(room.room)}
                >
                  <span aria-hidden>🧭</span> {t.rooms.showWay}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-brand-50/60 p-3">
          <Mascot size={52} />
          <div className="text-sm text-slate-700">
            <p>{hasSemester ? t.rooms.empty : t.rooms.emptyNoSemester}</p>
            {hasSemester && (
              <Link href="/settings" className="mt-1 inline-block font-medium text-brand-700 hover:underline">
                {t.rooms.emptyAction} →
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
