import "server-only";
import type { Locale } from "@/i18n/config";
import { campus } from "@/i18n/messages/campus";
import { CampuspathError, planRoute } from "./client";
import { campusHref, isClassroomId, routeLink, routeTitle } from "./links";
import { CampuspathUnavailable } from "./service";
import { isClassroom, type CampusPlace, type Coverage, type Floor, type PlanOutcome, type PlanRequest, type Reach, type Route } from "./types";

/**
 * Campus routes for the AI assistant: one call, a plain answer. No React or Next request APIs,
 * so a tool handler can call it directly.
 */

export interface CampusRouteStep {
  name: string;
  instruction: string;
  floor: Floor;
}

export type CampusRouteAnswer =
  | {
      kind: "route";
      /** "AC entrance → B419". */
      title: string;
      /** Where the walk starts: without `from`, the building entrance nearest the room, with its map pin. */
      start: { name: string; lat: number | null; lon: number | null };
      coverage: Coverage;
      reach: Reach;
      /** What the video does not show, in the requested language; null when it reaches the place. */
      notice: string | null;
      steps: CampusRouteStep[];
      durationSeconds: number;
      /** The in-app page with this route: `/campus?from=…&to=…[&dest=…]`. */
      link: string;
    }
  | {
      kind: "question";
      field: "start" | "destination";
      message: string;
      /**
       * Pass `value` back as `to` (destination) or `from` (start) to settle the question. Empty
       * when there is nothing to choose: `message` then explains (an unknown room, no route).
       */
      options: { label: string; value: string }[];
    }
  | { kind: "unavailable"; unavailable: true; message: string };

/** How far a route gets, also for places that are not catalogue rooms. */
function reachOf(route: Route): Reach {
  if (route.destination) return route.destination.reach;
  // A tour checkpoint asked for by name: the walk ends at that very view.
  return route.steps.length ? "room" : "none";
}

function optionValue(place: CampusPlace, field: "start" | "destination"): string {
  if (isClassroom(place)) return place.index;
  // A bare number is a checkpoint as a starting point; as a destination it could read as a room code.
  return field === "start" ? String(place.index) : `#${place.index}`;
}

/** Maps a planner outcome to the assistant's answer. */
export function toCampusAnswer(outcome: PlanOutcome): CampusRouteAnswer {
  if (outcome.kind === "question") {
    const { field, message, options } = outcome.question;
    return {
      kind: "question",
      field,
      message,
      options: options.map((place) => ({
        label: [place.name, place.area].filter(Boolean).join(" · "),
        value: optionValue(place, field),
      })),
    };
  }
  const route = outcome.route;
  const first = route.origin ?? route.steps[0];
  const pin = first && "pin" in first ? first.pin : undefined;
  return {
    kind: "route",
    title: routeTitle(route),
    start: { name: first?.name ?? "", lat: pin?.lat ?? null, lon: pin?.lon ?? null },
    coverage: route.coverage ?? "exact",
    reach: reachOf(route),
    notice: route.notice ?? null,
    steps: route.steps.map((s) => ({ name: s.name, instruction: s.instruction, floor: s.floor ?? null })),
    durationSeconds: route.duration,
    link: campusHref(routeLink(route)),
  };
}

/** The request for the service: a classroom id or a checkpoint number goes in as a choice. */
export function campusRequest(input: { to: string; from?: string; locale: Locale; home?: "hunedoara" }): PlanRequest {
  const to = input.to.trim();
  const from = input.from?.trim();
  const request: PlanRequest = { prompt: to, lang: input.locale };
  if (input.home) request.home = input.home;
  if (isClassroomId(to)) {
    request.prompt = "";
    request.destination = to;
  }
  if (from && isClassroomId(from)) request.start = from;
  else if (from) request.from = from;
  // No starting place: the entrance nearest the room, so the student is never asked where they are.
  else request.start = "auto";
  return request;
}

/**
 * Plans a walk on campus through the 360° tour. `to` is what the student asked for ("B419",
 * "sala A109 de la ASPC", a classroom id from an earlier question), `from` an optional starting
 * place (a checkpoint number, a place name or a classroom id); without it the walk starts at
 * the mapped building entrance nearest the room (`start` in the answer, with its coordinates).
 * `building`, when known (the building a timetable names), settles room codes that exist in
 * several buildings.
 */
export async function planCampusRoute(input: {
  to: string;
  from?: string;
  locale: Locale;
  building?: string;
  /** "hunedoara" for a student of that campus. */
  home?: "hunedoara";
}): Promise<CampusRouteAnswer> {
  const texts = campus[input.locale].api;
  try {
    return toCampusAnswer(await planRoute({ ...campusRequest(input), hint: input.building }));
  } catch (error) {
    if (error instanceof CampuspathUnavailable) return { kind: "unavailable", unavailable: true, message: texts.unavailable };
    if (!(error instanceof CampuspathError)) console.error("[campuspath] planCampusRoute failed", error);
    return { kind: "unavailable", unavailable: true, message: texts.failed };
  }
}
