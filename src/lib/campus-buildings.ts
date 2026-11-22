import "server-only";
import type { User } from "./auth";
import { currentSemester, placeResolver, studentWeek } from "./schedule";

/** A building where the student has classes this semester, with the rooms and courses held there. */
export interface StudentBuilding {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
  /** The timetable does not name the building of these rooms: the student's faculty is a guess. */
  guessed: boolean;
  rooms: string[];
  courses: string[];
  /** Classes per week held here, to order the buildings by how much the student uses them. */
  count: number;
}

/** The buildings a student actually uses, most used first. */
export function studentBuildings(user: Pick<User, "id" | "groupId" | "year" | "facultyId">): StudentBuilding[] {
  const semester = currentSemester();
  if (!semester || !user.groupId) return [];
  const place = placeResolver(user.facultyId);
  const byName = new Map<string, StudentBuilding>();
  for (const e of studentWeek(user, semester)) {
    const p = place(e.room);
    if (!p || !e.room) continue;
    // Rooms placed in a building by a guess are kept apart from the ones known to be there.
    const key = `${p.name}|${p.guessed ? "guess" : ""}`;
    const b = byName.get(key) ?? { name: p.name, address: p.address, lat: p.lat, lng: p.lng, approximate: p.approximate, guessed: !!p.guessed, rooms: [], courses: [], count: 0 };
    if (!b.rooms.includes(e.room)) b.rooms.push(e.room);
    const course = e.abbr ?? e.title;
    if (!b.courses.includes(course)) b.courses.push(course);
    b.count++;
    byName.set(key, b);
  }
  return [...byName.values()].map((b) => ({ ...b, rooms: b.rooms.sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) })).sort((a, b) => b.count - a.count);
}
