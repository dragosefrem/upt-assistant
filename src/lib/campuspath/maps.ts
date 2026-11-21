/**
 * Google Maps addresses for the walk to a building: the embedded map and the hand-over to the
 * Maps app. Pure functions, safe in client components.
 */
import type { Locale } from "@/i18n/config";

export type TravelMode = "walking" | "bicycling" | "transit" | "driving";
export const TRAVEL_MODES: TravelMode[] = ["walking", "bicycling", "transit", "driving"];

export interface LatLng {
  lat: number;
  lng: number;
}

const point = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

// The keyless map's travel flags: w(alk), b(ike), r (transit), d(rive).
const FLAGS: Record<TravelMode, string> = { walking: "w", bicycling: "b", transit: "r", driving: "d" };

/**
 * The address of an embedded map: the route from `origin` to `destination`, or the destination
 * alone when there is no origin. With a Maps Embed API key it uses the official embed; without
 * one, the keyless `output=embed` map (checked to render inside an iframe).
 */
export function mapsEmbedUrl(input: {
  destination: LatLng;
  origin?: LatLng | null;
  mode?: TravelMode;
  key?: string | null;
  locale?: Locale;
}): string {
  const mode = input.mode ?? "walking";
  const language = input.locale ?? "en";
  if (input.key) {
    if (input.origin) {
      const q = new URLSearchParams({ key: input.key, origin: point(input.origin), destination: point(input.destination), mode, language });
      return `https://www.google.com/maps/embed/v1/directions?${q}`;
    }
    const q = new URLSearchParams({ key: input.key, q: point(input.destination), zoom: "18", language });
    return `https://www.google.com/maps/embed/v1/place?${q}`;
  }
  if (input.origin) {
    const q = new URLSearchParams({ saddr: point(input.origin), daddr: point(input.destination), dirflg: FLAGS[mode], hl: language, output: "embed" });
    return `https://www.google.com/maps?${q}`;
  }
  const q = new URLSearchParams({ q: point(input.destination), z: "18", hl: language, output: "embed" });
  return `https://www.google.com/maps?${q}`;
}

/** "Open in Google Maps": directions in the browser, or in the phone's Maps app. */
export function mapsDirectionsUrl(input: { destination: LatLng; origin?: LatLng | null; mode?: TravelMode }): string {
  const q = new URLSearchParams({ api: "1" });
  if (input.origin) q.set("origin", point(input.origin));
  q.set("destination", point(input.destination));
  q.set("travelmode", input.mode ?? "walking");
  return `https://www.google.com/maps/dir/?${q}`;
}

/** "10:00" minus 17 minutes → "09:43" (the same day; never before midnight). */
export function leaveBy(at: string, minutes: number): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  if (!match) return null;
  const total = Math.max(0, Number(match[1]) * 60 + Number(match[2]) - Math.max(0, Math.round(minutes)));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
