import "server-only";
import catalogue from "../../../services/campuspath/data/classrooms.json";
import { wordsOf } from "./links";
import { roomKey } from "./rooms";

const codes = new Map<string, string>();
const sites = new Map<string, Set<string>>();
/** The faculties the catalogue lists for a room, by room key and site. */
const users = new Map<string, string[]>();
for (const room of catalogue.rooms) {
  if (!room.code) continue;
  const key = roomKey(room.code);
  codes.set(key, room.code);
  sites.set(key, (sites.get(key) ?? new Set()).add(room.site));
  const at = `${key}@${room.site}`;
  users.set(at, [...(users.get(at) ?? []), ...(room.faculties ?? [])]);
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
 *
 * With the student's faculty, a code that several buildings have goes to the one where the
 * catalogue lists that faculty for the room, as the campus page picks it: for a Construcții
 * student "A109" is the ASPC one, for Automatică și Calculatoare the one in Electro.
 */
export function campusRoomSite(location: string | null, faculty?: string | null): string | null {
  if (!location) return null;
  const found = roomSites(location);
  if (!found) return null;
  if (found.sites.length === 1) return found.sites[0];
  const wanted = [...wordsOf(faculty ?? "")].filter((word) => word !== "inginerie");
  if (!wanted.length) return null;
  const score = (site: string) => {
    const listed = wordsOf(found.keys.flatMap((k) => users.get(`${k}@${site}`) ?? []).join(" "));
    return wanted.filter((word) => listed.has(word)).length;
  };
  const ranked = found.sites.map((site) => ({ site, score: score(site) })).sort((a, b) => b.score - a.score);
  return ranked[0].score > 0 && ranked[0].score > ranked[1].score ? ranked[0].site : null;
}

/** The room codes a location names and the sites that have all of them (and are not ruled out by a building word). */
function roomSites(location: string): { keys: string[]; sites: string[] } | null {
  const whole = sites.get(key(location));
  if (whole) return { keys: [key(location)], sites: [...whole] };
  const words = fold(location).split(/[\s/,;]+/).filter(Boolean);
  const rooms: Set<string>[] = [];
  const keys: string[] = [];
  let named: string[] | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (FILLER.has(word)) continue;
    // "N 214": the wing and the number typed apart.
    const split = /^[A-Z]{1,3}$/.test(word) && /^\d/.test(words[i + 1] ?? "") ? sites.get(word + words[i + 1]) : undefined;
    const room = split ?? sites.get(word);
    if (room) {
      rooms.push(room);
      keys.push(split ? word + words[i + 1] : word);
      if (split) i++;
    } else if (BUILDING_WORDS[word]) {
      named = [...(named ?? []), ...BUILDING_WORDS[word]];
    } else {
      return null;
    }
  }
  if (!rooms.length) return null;
  const shared = [...rooms[0]].filter((site) => rooms.every((r) => r.has(site)) && (!named || named.includes(site)));
  return shared.length ? { keys, sites: shared } : null;
}
