/**
 * JSON shapes of the Campuspath service (services/campuspath), as its API returns them.
 * Safe to import from client components: types only.
 */
import type { Locale } from "@/i18n/config";

/** How far the tour reaches a classroom. See "Classroom directory" in the service README. */
export type Coverage = "exact" | "checkpoint" | "unmapped";

/** Where a route to a classroom ends, in the student's terms. */
export type Reach = "room" | "door" | "floor" | "near" | "checkpoint" | "entrance" | "none";

/** 0 is the ground floor, -1 the basement, "M" a mezzanine, "A" an attic; null when unknown. */
export type Floor = number | string | null;

/** A building pin from the university's campus map. */
export interface Pin {
  lat: number;
  lon: number;
  name: string;
}

/** One panorama of the 360° tour. */
export interface Checkpoint {
  index: number;
  name: string;
  label: string;
  area: string;
  floor: Floor;
  named: boolean;
  thumb: string | null;
  /** The same view in the original tour. */
  url: string;
  pin?: Pin;
}

export interface Source {
  title: string;
  url: string | null;
}

/** An entry of the classroom catalogue. `index` is its stable id, such as "room:electro-b419". */
export interface Classroom {
  index: string;
  code: string;
  name: string;
  label: string;
  area: string;
  faculties: string[];
  level: string | null;
  coverage: Coverage;
  reach: Reach;
  checkpoint: number | null;
  checkpointName: string | null;
  thumb: string | null;
  url: string | null;
  aliases: string[];
  sources: Source[];
}

/** A starting point or destination: a tour checkpoint or a classroom. */
export type CampusPlace = Checkpoint | Classroom;

export function isClassroom(place: CampusPlace): place is Classroom {
  return typeof place.index === "string";
}

/** One checkpoint of a route, with its direction and its moment in the video. */
export interface Step extends Checkpoint {
  /** Seconds from the start of the video. */
  time: number;
  instruction: string;
  arrivalYaw: number | null;
  yaw: number;
  pitch: number;
  kind: string;
  caption?: string;
}

export type VideoState =
  | { state: "ready"; key: string; url: string; poster: string }
  | { state: "queued" | "rendering"; key: string; completed: number; total: number }
  | { state: "error"; key: string; message: string };

export interface Route {
  steps: Step[];
  /** Length of the video in seconds; 0 when there is nothing to walk. */
  duration: number;
  lang: Locale;
  /** Missing on the bundled example, which always reaches its room. */
  coverage?: Coverage;
  destination?: Classroom;
  /** The starting room, or with an automatic start the entrance chosen (a checkpoint with its `pin`). */
  origin?: CampusPlace;
  /** The planner chose the start: the mapped entrance nearest the destination. */
  automatic?: boolean;
  notice?: string;
  /** Null when the route is a single checkpoint or the room is not in the tour. */
  video: VideoState | null;
}

/** The planner needs a choice before it can plan (HTTP 422). */
export interface Question {
  field: "start" | "destination";
  message: string;
  options: CampusPlace[];
  needsChoice: boolean;
}

export interface ClassroomPage {
  items: Classroom[];
  total: number;
  offset: number;
  limit: number;
  asOf: string;
}

export interface PlanRequest {
  /** What the student typed: a room code, a place or a sentence in Romanian or English. */
  prompt: string;
  /** A starting place named apart from the request: a checkpoint number or a place name. */
  from?: string;
  /**
   * A starting point chosen from a list (a checkpoint number or a classroom id), or "auto" for
   * the mapped building entrance from which the walk to the destination is shortest.
   */
  start?: number | string;
  /** A destination chosen from a list: a checkpoint number or a classroom id. */
  destination?: number | string;
  lang: Locale;
}

export type PlanOutcome = { kind: "route"; route: Route } | { kind: "question"; question: Question };
