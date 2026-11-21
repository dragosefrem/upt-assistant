"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import type { TimetableRoom } from "@/lib/campuspath/rooms";
import { YourRooms } from "./YourRooms";
import type { Classroom, ClassroomPage, Coverage } from "@/lib/campuspath/types";
import { formatDate } from "@/lib/time";
import { campusApi } from "./api";
import { Modal } from "../Modal";
import { reachTone } from "./format";
import { Thumb } from "./Thumb";

const PAGE = 20;
const FILTERS: (Coverage | "")[] = ["", "exact", "checkpoint", "unmapped"];

/** The classroom directory: search, filter by what the tour shows, page through, and route to a room. */
export function ClassroomBrowser({ rooms, hasSemester, onClose, onTake, onTimetableRoom }: {
  rooms: TimetableRoom[];
  hasSemester: boolean;
  onClose: () => void;
  onTake: (room: Classroom) => void;
  onTimetableRoom: (room: TimetableRoom) => void;
}) {
  const t = useT().campus;
  const [mine, setMine] = useState(rooms.length > 0);
  return (
    <Modal open title={t.directory.title} onClose={onClose} wide>
      <div role="group" aria-label={t.directory.title} className="segments mb-4">
        <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>{t.rooms.listLabel}</button>
        <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>{t.directory.allRooms}</button>
      </div>
      {mine ? <YourRooms rooms={rooms} hasSemester={hasSemester} onGo={onTimetableRoom} /> : <DirectorySearch onTake={onTake} />}
    </Modal>
  );
}

function DirectorySearch({ onTake }: { onTake: (room: Classroom) => void }) {
  const t = useT().campus;
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [coverage, setCoverage] = useState<Coverage | "">("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ClassroomPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      campusApi
        .classrooms(query.trim(), coverage, offset, PAGE)
        .then((result) => {
          if (!current) return;
          setPage(result);
          setFailed(false);
          if (offset) list.current?.scrollIntoView({ block: "nearest" });
        })
        .catch(() => current && setFailed(true))
        .finally(() => current && setLoading(false));
    }, query ? 180 : 0);
    return () => { window.clearTimeout(timer); current = false; };
  }, [query, coverage, offset]);

  const items = page?.items ?? [];
  const summary = !page ? t.directory.loading : query.trim() ? t.directory.found(page.total) : t.directory.listed(page.total);

  return (
    <>
      <label className="sr-only" htmlFor="campus-room-search">
        {t.directory.search}
      </label>
      <input
        id="campus-room-search"
        type="search"
        autoComplete="off"
        autoFocus
        className="field"
        placeholder={t.directory.searchHint}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffset(0);
        }}
      />
      <div role="group" aria-label={t.directory.coverageLabel} className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <button
            key={value || "all"}
            type="button"
            aria-pressed={coverage === value}
            onClick={() => {
              setCoverage(value);
              setOffset(0);
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition focus-visible:outline-2 focus-visible:outline-brand-500 ${
              coverage === value ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {t.directory.coverage[value || "all"]}
          </button>
        ))}
      </div>
      <p role="status" className="mt-3 text-sm text-slate-600">
        {failed ? t.picker.searchDown : loading && !page ? t.directory.loading : page && !page.total ? t.directory.noMatch : summary}
      </p>
      <ul ref={list} className={`mt-2 space-y-2 transition-opacity ${loading && page ? "opacity-60" : ""}`}>
        {items.map((room) => (
          <li key={room.index} className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-start gap-3">
              <Thumb src={room.thumb} className="hidden h-14 w-20 sm:flex" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-slate-900">{room.name}</p>
                <p className="text-xs text-slate-500">
                  {[room.area, room.level ? t.floors.level(room.level) : null, room.faculties.join(", ") || null].filter(Boolean).join(" · ")}
                </p>
                <span className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${reachTone(room)}`}>{t.reach[room.reach]}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {room.sources.length > 0 ? (
                <details className="min-w-0 flex-1 text-xs text-slate-600">
                  <summary className="cursor-pointer select-none rounded text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                    {t.directory.sources(room.sources.length)}
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {room.sources.map((source, i) => (
                      <li key={i} className="break-words">
                        {source.url ? (
                          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                            {source.title}
                          </a>
                        ) : (
                          source.title
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                onClick={() => onTake(room)}
                aria-label={t.directory.takeMeTo(room.code || room.label)}
              >
                {t.directory.takeMeThere} <span aria-hidden>→</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {page && page.total > PAGE && (
        <nav className="mt-3 flex items-center justify-between gap-2" aria-label={t.directory.title}>
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ← {t.directory.previous}
          </button>
          <span className="text-xs tabular-nums text-slate-600">
            {t.directory.range(page.total ? page.offset + 1 : 0, page.offset + items.length, page.total)}
          </span>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            disabled={page.offset + page.limit >= page.total}
            onClick={() => setOffset(offset + PAGE)}
          >
            {t.directory.next} →
          </button>
        </nav>
      )}
      {page?.asOf && <p className="mt-4 text-xs text-slate-500">{t.directory.asOf(formatDate(page.asOf, { day: "numeric", month: "long", year: "numeric" }, locale))}</p>}
    </>
  );
}
