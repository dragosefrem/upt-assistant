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

export function planTrip(from: LatLng, place: Place): Directions {
  const straight = haversineMeters(from, place);
  // Streets are not straight lines; 1.3 is a common urban detour factor.
  const route = straight * 1.3;
  const walk = Math.max(1, Math.round(route / 80)); // ~4.8 km/h
  const bike = Math.max(1, Math.round(route / 250) + 2); // ~15 km/h + unlocking
  const transit = Math.round(route / 300) + 8; // ~18 km/h + waiting
  const drive = Math.round(route / 420) + 5; // ~25 km/h in town + parking

  const options: TravelOption[] = [];
  if (route <= 4000) options.push({ mode: "walk", label: "Walk", minutes: walk, mapsUrl: mapsUrl(from, place, "walking") });
  if (route > 800 && route <= 12_000) options.push({ mode: "bike", label: "Bike or scooter", minutes: bike, mapsUrl: mapsUrl(from, place, "bicycling") });
  if (route > 1200) options.push({ mode: "transit", label: "Public transport", minutes: transit, mapsUrl: mapsUrl(from, place, "transit") });
  if (route > 2500) options.push({ mode: "drive", label: "Car or taxi", minutes: drive, mapsUrl: mapsUrl(from, place, "driving") });
  if (!options.length) options.push({ mode: "walk", label: "Walk", minutes: walk, mapsUrl: mapsUrl(from, place, "walking") });

  const best = [...options].sort((a, b) => a.minutes - b.minutes)[0];
  const recommended = route <= 1500 ? options[0] : best;
  const km = route >= 1000 ? `${(route / 1000).toFixed(1)} km` : `${Math.round(route / 10) * 10} m`;
  const summary =
    straight < 80
      ? `You are already at ${place.name}.`
      : `${place.name} is about ${km} away. ${recommended.label}: roughly ${recommended.minutes} min.`;

  return {
    destination: place.name,
    address: place.address,
    approximate: place.approximate,
    distanceMeters: Math.round(route),
    summary,
    options,
    // A few minutes' margin to find the room.
    leaveMinutesBefore: straight < 80 ? 0 : recommended.minutes + 5,
  };
}
