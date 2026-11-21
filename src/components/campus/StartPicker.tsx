"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { rankPins, type RankedPin } from "@/lib/campuspath/links";
import { isClassroom, type CampusPlace, type Checkpoint } from "@/lib/campuspath/types";
import { useLocation } from "../LocationProvider";
import { campusApi } from "./api";
import { Modal } from "../Modal";
import { distanceLabel, roomFacts } from "./format";
import { Thumb } from "./Thumb";

type Choice = CampusPlace & { distance?: number };

/**
 * Choose a starting point: search the tour by name, number (#389) or tour link, or let the
 * device's location rank the 24 mapped campus buildings. The student confirms the view.
 */
export function StartPicker({
  open,
  locate,
  onClose,
  onPick,
}: {
  open: boolean;
  /** Start by ranking buildings near the student. */
  locate: boolean;
  onClose: () => void;
  onPick: (place: CampusPlace) => void;
}) {
  const t = useT().campus;
  const locale = useLocale();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [note, setNote] = useState("");
  const [locating, setLocating] = useState(false);
  const pins = useRef<Checkpoint[] | null>(null);
  const token = useRef(0);
  const asked = useRef(false);
  const searchTimer = useRef<number | undefined>(undefined);

  const search = (q: string) => {
    const mine = ++token.current;
    campusApi
      .checkpoints(q.trim())
      .then((found) => {
        if (mine !== token.current) return;
        setChoices(found);
        setNote(found.length ? t.picker.selectView : t.picker.noMatch);
      })
      .catch(() => mine === token.current && setNote(t.picker.searchDown));
  };

  const nearby = () => {
    ++token.current;
    asked.current = false;
    setLocating(true);
    setNote(t.picker.lookingNearby);
    if (location.status !== "on") location.enable();
  };

  // Open: search everything, or find nearby buildings. Close: forget the query.
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the dialog starts fresh each time it opens */
    setQuery("");
    setChoices([]);
    setNote(t.picker.loading);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (locate) nearby();
    else search("");
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Rank buildings once the browser has a position; explain when it will not give one.
  useEffect(() => {
    if (!locating || !open) return;
    if (location.status === "asking") {
      asked.current = true;
      return;
    }
    const fallBack = (why: string) => {
      setLocating(false);
      const mine = ++token.current;
      campusApi
        .checkpoints("")
        .then((found) => mine === token.current && setChoices(found))
        .catch(() => {});
      setNote(`${why} ${t.picker.chooseBelow}`);
    };
    if (location.status === "denied") return fallBack(t.picker.declined);
    if (location.status === "unsupported") return fallBack(t.picker.unsupported);
    if (location.status === "idle" && asked.current) return fallBack(t.picker.noLocation);
    const here = location.position;
    if (!here) return;
    const mine = ++token.current;
    (pins.current ? Promise.resolve(pins.current) : campusApi.pins())
      .then((all) => {
        pins.current = all;
        if (mine !== token.current) return;
        const ranked: RankedPin[] = rankPins(all, { lat: here.lat, lon: here.lng }, 6);
        if (!ranked.length) throw new Error("no pins");
        setLocating(false);
        setChoices(ranked);
        const where = ranked[0].distance > 1000 ? t.picker.closest(distanceLabel(ranked[0].distance, locale)) : t.picker.nearHere;
        setNote(`${where} ${t.picker.confirmView} ${t.picker.buildingsOnly}`);
      })
      .catch(() => mine === token.current && fallBack(t.picker.noLocation));
  }, [locating, open, location.status, location.position, t, locale]);

  return (
    <Modal open={open} title={t.picker.title} onClose={onClose}>
      <label className="sr-only" htmlFor="campus-start-search">
        {t.picker.search}
      </label>
      <input
        id="campus-start-search"
        type="search"
        autoComplete="off"
        autoFocus
        className="field"
        placeholder={t.picker.searchHint}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLocating(false);
          const q = e.target.value;
          window.clearTimeout(searchTimer.current);
          searchTimer.current = window.setTimeout(() => search(q), 160);
        }}
      />
      <button type="button" className="btn-ghost mt-2 px-2 text-brand-700" onClick={nearby}>
        <span aria-hidden>📍</span>
        {t.picker.nearby}
      </button>
      <p role="status" className="mt-1 min-h-5 text-sm text-slate-600">
        {note}
      </p>
      <ul className="mt-2 space-y-1.5">
        {choices.map((place) => (
          <li key={String(place.index)}>
            <button
              type="button"
              onClick={() => onPick(place)}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 p-2 text-left transition hover:border-brand-200 hover:bg-brand-50/60 focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <Thumb src={place.thumb} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{place.name}</span>
                <span className="block text-xs text-slate-500">
                  {(isClassroom(place) ? roomFacts(place, t) : [place.area, t.picker.checkpoint(place.index)])
                    .concat(place.distance !== undefined ? [t.picker.toPin(distanceLabel(place.distance, locale))] : [])
                    .join(" · ")}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

