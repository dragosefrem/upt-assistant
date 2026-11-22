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
 * Words a timetable writes beside a room code to name its building, with the catalogue sites
 * they stand for: "C301B ET" (clădirea ET, Electro), "A303 Ch", "N 214 sau M214 Mec".
 */
const BUILDING_WORDS: Record<string, string[]> = {
  ET: ["electro"], ELECTRO: ["electro"],
  CH: ["chimie"], CHIM: ["chimie"], CHIMIE: ["chimie"],
  MEC: ["mecanica"], MECANICA: ["mecanica"],
};
/** Words that say nothing about where the room is. */
const FILLER = new Set(["SALA", "ROOM", "SAU", "OR", "SI"]);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

/**
 * The building of the campus tour's catalogue that holds a room with this code, by its site id
 * ("electro", "chimie"); null when no building or more than one has such a room. "P08" is in
 * Chimie alone; "A109" is in Electro and in ASPC, so the code does not say which.
 *
 * A location may also list several rooms and name their building in a word: "M214/N214" are
 * both in Mecanică, and "A303 Ch" is the A303 of Chimie, though three other buildings have one.
 * Anything else written there, and the location is not read as room codes at all.
 */
export function campusRoomSite(location: string | null): string | null {
  if (!location) return null;
  const whole = sites.get(key(location));
  if (whole) return whole.size === 1 ? [...whole][0] : null;
  const words = fold(location).split(/[\s/,;]+/).filter(Boolean);
  const rooms: Set<string>[] = [];
  let named: string[] | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (FILLER.has(word)) continue;
    // "N 214": the wing and the number typed apart.
    const split = /^[A-Z]{1,3}$/.test(word) && /^\d/.test(words[i + 1] ?? "") ? sites.get(word + words[i + 1]) : undefined;
    const room = split ?? sites.get(word);
    if (room) {
      rooms.push(room);
      if (split) i++;
    } else if (BUILDING_WORDS[word]) {
      named = [...(named ?? []), ...BUILDING_WORDS[word]];
    } else {
      return null;
    }
  }
  if (!rooms.length) return null;
  const shared = [...rooms[0]].filter((site) => rooms.every((r) => r.has(site)) && (!named || named.includes(site)));
  return shared.length === 1 ? shared[0] : null;
}
