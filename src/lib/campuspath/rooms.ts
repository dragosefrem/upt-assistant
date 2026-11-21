import type { Locale } from "@/i18n/config";
import { kindLabel } from "@/lib/kinds";

/** A room from the student's timetable, ready for the "Your rooms" list. */
export interface TimetableRoom {
  /** As the timetable writes it: "A315", "C 219", "105 SPM". */
  room: string;
  /** The building the timetable places it in, if known. */
  building: string | null;
  /** The building is a guess (the student's faculty), not a match on the room code. */
  approximate: boolean;
  /** Words that tell apart rooms with the same code in different buildings. */
  hint: string;
  /** Classes a week held there. */
  classes: number;
  courses: { title: string; kinds: string[] }[];
}

interface Entry {
  title: string;
  kind: string;
  room: string | null;
}

interface Place {
  name: string;
  approximate: boolean;
}

/** "c 219" and "C219" are the same room. */
export function roomKey(room: string): string {
  return room.replace(/\s+/g, "").toUpperCase();
}

/**
 * Each distinct room of a weekly timetable with the courses held there (kinds in the
 * interface language), most-used rooms first. Online classes are left out.
 */
export function groupRooms(
  entries: Entry[],
  place: (room: string) => Place | null,
  locale: Locale,
  faculty: string | null = null,
): TimetableRoom[] {
  const rooms = new Map<string, { room: string; place: Place | null; classes: number; courses: Map<string, Set<string>> }>();
  for (const entry of entries) {
    const room = entry.room?.replace(/\s+/g, " ").trim();
    if (!room || /\bon\s?line\b/i.test(room)) continue;
    const key = roomKey(room);
    let item = rooms.get(key);
    if (!item) {
      item = { room, place: place(room), classes: 0, courses: new Map() };
      rooms.set(key, item);
    }
    item.classes++;
    const kinds = item.courses.get(entry.title) ?? new Set<string>();
    kinds.add(entry.kind);
    item.courses.set(entry.title, kinds);
  }
  const order = ["course", "seminar", "lab", "project", "other"];
  return [...rooms.values()]
    .map((item) => ({
      room: item.room,
      building: item.place?.name ?? null,
      approximate: item.place?.approximate ?? false,
      hint: [item.place?.name, faculty].filter(Boolean).join(" "),
      classes: item.classes,
      courses: [...item.courses].map(([title, kinds]) => ({
        title,
        kinds: [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => kindLabel(k, locale)),
      })),
    }))
    .sort((a, b) => b.classes - a.classes || a.room.localeCompare(b.room, undefined, { numeric: true }));
}
