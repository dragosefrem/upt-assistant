import "server-only";
import catalogue from "../../../services/campuspath/data/classrooms.json";
import { roomKey } from "./rooms";

const codes = new Map<string, string>();
const sites = new Map<string, Set<string>>();
for (const room of catalogue.rooms) {
  if (!room.code) continue;
  const key = roomKey(room.code);
  codes.set(key, room.code);
  sites.set(key, (sites.get(key) ?? new Set()).add(room.site));
}

const key = (location: string) => roomKey(location.trim().replace(/^(?:room|sala)\s+/i, ""));

/** A meeting location can also be an address, a café or a video link. */
export function campusRoomCode(location: string | null): string | undefined {
  if (!location) return undefined;
  return codes.get(key(location));
}

/**
 * The building of the campus tour's catalogue that holds a room with this code, by its site id
 * ("electro", "chimie"); null when no building or more than one has such a room. "P08" is in
 * Chimie alone; "A109" is in Electro and in ASPC, so the code does not say which.
 */
export function campusRoomSite(location: string | null): string | null {
  const found = location ? sites.get(key(location)) : undefined;
  return found?.size === 1 ? [...found][0] : null;
}
