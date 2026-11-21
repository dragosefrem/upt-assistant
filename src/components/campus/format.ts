import { DATE_LOCALE, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { Classroom, Floor, Route } from "@/lib/campuspath/types";

type T = Messages["campus"];

/** 75 → "1:15". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 140 → "140 m", 2300 → "2,3 km" / "2.3 km". */
export function distanceLabel(metres: number, locale: Locale): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${new Intl.NumberFormat(DATE_LOCALE[locale], { maximumFractionDigits: 1 }).format(metres / 1000)} km`;
}

/** A checkpoint's floor in words, or null when unknown. */
export function floorLabel(floor: Floor, t: T): string | null {
  if (floor === null || floor === undefined || floor === "") return null;
  if (floor === 0) return t.floors.ground;
  if (floor === -1) return t.floors.basement;
  if (floor === "M") return t.floors.mezzanine;
  if (floor === "A") return t.floors.attic;
  return t.floors.floor(floor);
}

/** The floor the student is heading for: the room's own level, else where the walk ends. */
export function routeFloor(route: Route, t: T): string | null {
  if (route.destination?.level) return t.floors.level(route.destination.level);
  return floorLabel(route.steps.at(-1)?.floor ?? null, t);
}

/** "Electro · Bd. Vasile Pârvan 2 · Floor 4 · Video to its floor". */
export function roomFacts(room: Classroom, t: T): string[] {
  return [room.area, room.level ? t.floors.level(room.level) : null, t.reach[room.reach]].filter((x): x is string => !!x);
}

/** Badge colours for how far the tour reaches a room. */
export function reachTone(room: Pick<Classroom, "coverage">): string {
  if (room.coverage === "exact") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (room.coverage === "checkpoint") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Brings an element into view, without animation for those who ask for less motion. */
export function reveal(element: Element | null, block: ScrollLogicalPosition = "start") {
  element?.scrollIntoView({ block, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** "B527" → "b527", for file names. */
export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
}
