"use client";

import { ArrowRight, DoorOpen } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import type { TimetableRoom } from "@/lib/campuspath/rooms";

export function YourRooms({ rooms, hasSemester, onGo }: {
  rooms: TimetableRoom[];
  hasSemester: boolean;
  onGo: (room: TimetableRoom) => void;
}) {
  const t = useT().campus.rooms;
  if (!rooms.length) return (
    <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
      <p>{hasSemester ? t.empty : t.emptyNoSemester}</p>
      {hasSemester && <Link href="/settings#courses" className="mt-2 inline-block font-semibold text-brand-700 underline">{t.emptyAction}</Link>}
    </div>
  );

  return (
    <ul aria-label={t.listLabel} className="divide-y divide-slate-100">
      {rooms.map((room) => (
        <li key={room.room}>
          <button type="button" onClick={() => onGo(room)} aria-label={t.showWayTo(room.room)}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-brand-50">
            <DoorOpen size={20} className="shrink-0 text-brand-600" aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">{room.room}</strong>
              <span className="block text-xs text-slate-600">{room.building ? (room.approximate ? t.approximate(room.building) : room.building) : t.unknownBuilding}</span>
              <span className="mt-1 block text-xs text-slate-600">{room.courses.map((c) => c.title).join(" · ")}</span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-brand-600" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
