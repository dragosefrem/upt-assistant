import { DATE_LOCALE, type Locale } from "@/i18n/config";
import { calendar } from "@/i18n/messages/calendar";
import type { Place } from "./schedule";

/** Travel suggestions between two points. Pure maths: no routing service is called. */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TravelOption {
  mode: "walk" | "bike" | "transit" | "drive";
  label: string;
  minutes: number;
  mapsUrl: string;
}

export interface Directions {
  destination: string;
  address: string | null;
  approximate: boolean;
  distanceMeters: number;
  summary: string;
  options: TravelOption[];
  /** Minutes before the start time to set off, using the recommended option. */
  leaveMinutesBefore: number;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function mapsUrl(from: LatLng, to: LatLng, mode: "walking" | "bicycling" | "transit" | "driving") {
  const q = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${q}`;
}

/** Labels and the summary are written in `locale` (English by default, as the assistant model reads them). */
export function planTrip(from: LatLng, place: Place, locale: Locale = "en", showAllModes = false): Directions {
  const t = calendar[locale].directions;
  const straight = haversineMeters(from, place);
  // Streets are not straight lines; 1.3 is a common urban detour factor.
  const route = straight * 1.3;
  const walk = Math.max(1, Math.round(route / 80)); // ~4.8 km/h
  const bike = Math.max(1, Math.round(route / 250) + 2); // ~15 km/h + unlocking
  const transit = Math.round(route / 300) + 8; // ~18 km/h + waiting
  const drive = Math.round(route / 420) + 5; // ~25 km/h in town + parking

  const allModes: TravelOption[] = [
    { mode: "walk", label: t.walk, minutes: walk, mapsUrl: mapsUrl(from, place, "walking") },
    { mode: "bike", label: t.bike, minutes: bike, mapsUrl: mapsUrl(from, place, "bicycling") },
    { mode: "transit", label: t.transit, minutes: transit, mapsUrl: mapsUrl(from, place, "transit") },
    { mode: "drive", label: t.drive, minutes: drive, mapsUrl: mapsUrl(from, place, "driving") },
  ];
  const suitable = { walk: route <= 4000, bike: route > 800 && route <= 12_000, transit: route > 1200, drive: route > 2500 };
  const options = allModes.filter((option) => suitable[option.mode]);

  const best = [...options].sort((a, b) => a.minutes - b.minutes)[0];
  const recommended = route <= 1500 ? options[0] : best;
  const km =
    route >= 1000
      ? `${new Intl.NumberFormat(DATE_LOCALE[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(route / 1000)} km`
      : `${Math.round(route / 10) * 10} m`;
  const summary = straight < 80 ? t.alreadyThere(place.name) : t.summary(place.name, km, recommended.label, recommended.minutes);

  return {
    destination: place.name,
    address: place.address,
    approximate: place.approximate,
    distanceMeters: Math.round(route),
    summary,
    options: showAllModes ? allModes : options,
    // A few minutes' margin to find the room.
    leaveMinutesBefore: straight < 80 ? 0 : recommended.minutes + 5,
  };
}
