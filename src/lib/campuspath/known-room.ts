import "server-only";
import catalogue from "../../../services/campuspath/data/classrooms.json";
import { roomKey } from "./rooms";

const codes = new Map<string, string>();
for (const room of catalogue.rooms) {
  if (room.code) codes.set(roomKey(room.code), room.code);
}

/** A meeting location can also be an address, a café or a video link. */
export function campusRoomCode(location: string | null): string | undefined {
  if (!location) return undefined;
  return codes.get(roomKey(location.trim().replace(/^(?:room|sala)\s+/i, "")));
}
