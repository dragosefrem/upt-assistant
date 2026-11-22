/**
 * Pure helpers for campus routes: in-app addresses, media names, titles, distances and
 * choosing between rooms that share a code. No server or browser APIs, so the page, the
 * API routes, the assistant and the tests all share them.
 */
import { isLocale, type Locale } from "@/i18n/config";
import { localInstant } from "@/lib/time";
import type { CampusPlace, Checkpoint, Classroom, Route, VideoState } from "./types";

/* ───────────── Addresses ───────────── */

/** The fields of a route address: `/campus?from=355&to=B527&dest=room:electro-b527`. */
export interface CampusLink {
  /** A checkpoint number or a place name. */
  from?: string;
  /** Whatever a student would type: a room code, a place or a sentence. */
  to?: string;
  /** Pins a classroom when a code exists in two buildings. */
  dest?: string;
  lang?: Locale;
  /** The building the timetable names: settles a code that exists in two buildings, and is shown. */
  building?: string;
  /** When the class starts, "HH:MM": the page says when to leave. */
  at?: string;
  /** Campus date of a class opened from the calendar. */
  date?: string;
  /** The class the walk is for, shown in the header. */
  course?: string;
}

/** The fields a route's QR code may carry: the service refuses any other. */
export const SHARED_FIELDS = ["from", "to", "dest", "lang"] as const;

export const CAMPUS_PATH = "/campus";
const LONGEST = { from: 200, to: 1000, building: 200, course: 200 } as const;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLASSROOM_ID = /^room:[a-z0-9][a-z0-9-]{0,80}$/;

export function isClassroomId(value: unknown): value is string {
  return typeof value === "string" && CLASSROOM_ID.test(value);
}

/** The in-app address of a route, such as `/campus?from=355&to=B527`. Empty fields are left out. */
export function campusHref(link: CampusLink): string {
  const params = new URLSearchParams();
  if (link.from?.trim()) params.set("from", link.from.trim());
  if (link.to?.trim()) params.set("to", link.to.trim());
  if (link.dest && isClassroomId(link.dest)) params.set("dest", link.dest);
  if (link.lang) params.set("lang", link.lang);
  if (link.building?.trim()) params.set("building", link.building.trim().slice(0, LONGEST.building));
  if (link.at && CLOCK.test(link.at)) params.set("at", link.at);
  if (link.date && localInstant(`${link.date}T12:00`) !== null) params.set("date", link.date);
  if (link.course?.trim()) params.set("course", link.course.trim().slice(0, LONGEST.course));
  const query = params.toString();
  return query ? `${CAMPUS_PATH}?${query}` : CAMPUS_PATH;
}

/**
 * The door-to-door journey to a room, for links from elsewhere in the app (a class in the
 * calendar): `/campus?to=A315&building=…&at=10:00&course=…`. With no `from`, the page starts at
 * the building entrance nearest the room and shows the way there on a map first.
 */
export function campusJourneyHref(input: { to: string; building?: string | null; at?: string | null; date?: string; course?: string | null }): string {
  return campusHref({ to: input.to, building: input.building ?? undefined, at: input.at ?? undefined, date: input.date, course: input.course ?? undefined });
}

/** The address a QR code or a copied link carries: only the fields the service accepts. */
export function sharedHref(link: CampusLink): string {
  return campusHref({ from: link.from, to: link.to, dest: link.dest, lang: link.lang });
}

type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

function first(input: SearchInput, key: string): string | undefined {
  const value = input instanceof URLSearchParams ? input.get(key) ?? undefined : input[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Reads a route address from the page's search parameters, dropping anything out of bounds. */
export function parseCampusLink(input: SearchInput): CampusLink {
  const link: CampusLink = {};
  const from = first(input, "from")?.trim();
  const to = first(input, "to")?.trim();
  const dest = first(input, "dest")?.trim();
  const lang = first(input, "lang");
  if (from && from.length <= LONGEST.from) link.from = from;
  if (to && to.length <= LONGEST.to) link.to = to;
  if (dest && isClassroomId(dest)) link.dest = dest;
  if (isLocale(lang)) link.lang = lang;
  const building = first(input, "building")?.trim();
  const at = first(input, "at")?.trim();
  const date = first(input, "date")?.trim();
  const course = first(input, "course")?.trim();
  if (building && building.length <= LONGEST.building) link.building = building;
  if (at && CLOCK.test(at)) link.at = at;
  if (date && localInstant(`${date}T12:00`) !== null) link.date = date;
  if (course && course.length <= LONGEST.course) link.course = course;
  return link;
}

/** The place the student asked for. A video that stops short of a room is still a route to that room. */
export function routeGoal(route: Route): string {
  const room = route.destination;
  if (room) return room.code || room.label;
  return route.steps.at(-1)?.name ?? "";
}

/** "AC entrance → B527"; a route of one checkpoint is that place alone. */
export function routeTitle(route: Route): string {
  const first = route.steps[0];
  const last = route.steps.at(-1);
  if (!first || !last) return route.destination?.name ?? "";
  if (route.steps.length === 1) return last.name;
  return `${first.name} → ${routeGoal(route)}`;
}

/**
 * The address that opens this route again. A route that started at the entrance the planner
 * chose has no `from`, so the link opens the same door-to-door journey.
 */
export function routeLink(route: Route): CampusLink {
  const room = route.destination;
  const last = route.steps.at(-1);
  const link: CampusLink = {};
  if (route.steps.length && !route.automatic) link.from = String(route.steps[0].index);
  if (room) {
    link.to = room.code || room.label;
    link.dest = room.index;
  } else if (last) {
    link.to = `#${last.index}`;
  }
  return link;
}

/** The entrance a journey starts at, with its map pin; null when the walk does not start outdoors at a pin. */
export function routeEntrance(route: Route): (Checkpoint & { pin: NonNullable<Checkpoint["pin"]> }) | null {
  const first = route.steps[0];
  if (first?.pin) return first as Checkpoint & { pin: NonNullable<Checkpoint["pin"]> };
  const origin = route.origin;
  if (origin && typeof origin.index === "number" && (origin as Checkpoint).pin) return origin as Checkpoint & { pin: NonNullable<Checkpoint["pin"]> };
  return null;
}

/* ───────────── Media ───────────── */

/** Video keys are the first 24 hex digits of a SHA-256. */
export const VIDEO_KEY = /^[0-9a-f]{24}$/;

export function isVideoKey(value: unknown): value is string {
  return typeof value === "string" && VIDEO_KEY.test(value);
}

export type MediaKind = "mp4" | "jpg";

/** "2096d2c5366c9e70453ee895.mp4" → its key and kind; anything else → null. */
export function parseMediaName(name: string): { key: string; kind: MediaKind } | null {
  const match = /^([0-9a-f]{24})\.(mp4|jpg)$/.exec(name);
  return match ? { key: match[1], kind: match[2] as MediaKind } : null;
}

export function mediaPath(key: string, kind: MediaKind): string {
  return `/api/campus/media/${key}.${kind}`;
}

/** A video state with its files served through this app instead of the service. */
export function appVideo(video: VideoState | null): VideoState | null {
  if (!video || video.state !== "ready" || !isVideoKey(video.key)) return video;
  return { ...video, url: mediaPath(video.key, "mp4"), poster: mediaPath(video.key, "jpg") };
}

/** Where one checkpoint of the video ends: just before the next one starts, on its last frame. */
export function stepEnd(route: Route, index: number): number {
  const next = route.steps[index + 1];
  return (next ? next.time : route.duration) - 0.06;
}

/* ───────────── Distances ───────────── */

export interface LatLon {
  lat: number;
  lon: number;
}

export function metresBetween(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type RankedPin = Checkpoint & { distance: number };

/** Building pins nearest first, with their distance in metres. Checkpoints without a pin are left out. */
export function rankPins(points: Checkpoint[], here: LatLon, limit = 6): RankedPin[] {
  return points
    .filter((p): p is Checkpoint & { pin: NonNullable<Checkpoint["pin"]> } => !!p.pin && Number.isFinite(p.pin.lat) && Number.isFinite(p.pin.lon))
    .map((p) => ({ ...p, distance: metresBetween(here, p.pin) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, limit);
}

/* ───────────── Rooms that share a code ───────────── */

/** Lower case without diacritics: "Construcții" → "constructii". */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// Words in building and faculty names that say nothing about which one it is.
const COMMON = new Set(
  "a al ale and bd building cladirea corp corpul de din facultatea faculty for in inclusiv la of pentru si str the unconfirmed".split(" "),
);

function wordsOf(value: string): Set<string> {
  return new Set(fold(value).split(/[^a-z0-9]+/).filter((w) => w && !COMMON.has(w) && !/^\d+$/.test(w)));
}

/**
 * Of several classrooms with the same code (A109 is in Electro and in ASPC), the one whose
 * building or faculty matches the hint, such as the building the timetable names. Null when
 * no single option matches better than the rest.
 */
export function pickByHint(options: CampusPlace[], hint: string | undefined): Classroom | null {
  const wanted = wordsOf(hint ?? "");
  if (!wanted.size) return null;
  let best: Classroom | null = null;
  let bestScore = 0;
  let tied = false;
  for (const option of options) {
    if (typeof option.index !== "string") continue;
    const room = option as Classroom;
    const have = wordsOf([room.area, ...(room.areaAliases ?? []), ...room.faculties].join(" "));
    let score = 0;
    for (const word of wanted) if (have.has(word)) score++;
    if (score > bestScore) {
      best = room;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return bestScore > 0 && !tied ? best : null;
}

/**
 * Settles a code that exists in several buildings for a class from a timetable. The building
 * the timetable names decides alone: when none of the rooms is in it, nobody is sent to another
 * building because their faculty teaches there. The student's faculty only helps when the
 * timetable names no building.
 */
export function pickForTimetable(options: CampusPlace[], known: { building?: string; faculty?: string }): Classroom | null {
  if (known.building?.trim()) return pickByHint(options, known.building);
  return pickByHint(options, known.faculty);
}
