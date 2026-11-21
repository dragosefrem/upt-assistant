import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { savedContacts } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { describeGroup, findGroups } from "./schedule";

/**
 * People without an account: a name and the group whose published timetable stands in for
 * them ("Mindy is in TI 3.2"). The assistant reads these to plan around a friend's classes.
 */

export const SAVED_NAME_MAX = 60;

/** Lower-cased, accent-free name; unique per user, so saving a name again updates it. */
export function savedNameKey(name: string): string {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface GroupChoice {
  groupId: number;
  /** "Specialization, year N, group label" in `locale`. */
  group: string;
  /** Specialization code (TI, C-EN), which tells apart lines with the same name. */
  code: string | null;
  /** Faculty short name. */
  faculty: string;
}

export interface SavedContact {
  id: number;
  name: string;
  groupId: number | null;
  /** Null when the group has left the timetable. */
  group: GroupChoice | null;
}

/** The group as the interface shows it, or null if it no longer exists. */
export function groupChoice(groupId: number | null, locale: Locale = "en"): GroupChoice | null {
  const info = describeGroup(groupId, locale);
  if (!info) return null;
  return {
    groupId: info.group.id,
    group: `${info.spec.name}, ${common[locale].time.year(info.group.year)}, ${info.label}`,
    code: info.spec.code,
    faculty: info.faculty.shortName ?? info.faculty.name,
  };
}

export function listSavedContacts(userId: string, locale: Locale = "en"): SavedContact[] {
  return getDb().select({ id: savedContacts.id, name: savedContacts.name, groupId: savedContacts.groupId })
    .from(savedContacts).where(eq(savedContacts.userId, userId))
    .orderBy(asc(savedContacts.nameKey), asc(savedContacts.id)).all()
    .map((row) => ({ ...row, group: groupChoice(row.groupId, locale) }));
}

/**
 * Groups matching a loosely typed name ("TI 3.2", "Calculatoare anul 2 2.1"), best first:
 * the student's own faculty if anything there matches, else any faculty. Only matches as
 * good as the best one are returned, so one result means the query is unambiguous and
 * none means nothing matched.
 */
export function matchGroups(query: string, facultyId: number | null, preferYear: number | null, locale: Locale = "en", limit = 5): GroupChoice[] {
  if (!query.trim()) return [];
  let found = findGroups(query, facultyId, preferYear, 50);
  if (!found.length && facultyId) found = findGroups(query, null, preferYear, 50);
  if (!found.length) return [];
  // A year written out ("anul 2", "year 3") is a firm hint, not just one more token to score.
  const year = Number(/\b(?:anul|an|year)\s*(\d)\b/i.exec(query)?.[1]);
  if (year && found.some((match) => match.group.year === year)) found = found.filter((match) => match.group.year === year);
  // `findGroups` adds a small bonus for the student's own year: it orders equally good
  // matches, but a group in another year that matches the text just as well stays a choice.
  const text = (match: (typeof found)[number]) => match.score - (preferYear && match.group.year === preferYear ? 0.5 : 0);
  const best = Math.max(...found.map(text));
  return found.filter((match) => text(match) >= best).slice(0, limit)
    .flatMap((match) => groupChoice(match.group.id, locale) ?? []);
}

export class SavedContactError extends Error {
  constructor(readonly code: "name" | "nameTooLong" | "groupGone") {
    super(code);
    this.name = "SavedContactError";
  }
}

/** Adds a person, or updates the group of the one already saved under that name. */
export function saveContact(userId: string, name: string, groupId: number): { id: number; name: string; created: boolean } {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new SavedContactError("name");
  if (clean.length > SAVED_NAME_MAX) throw new SavedContactError("nameTooLong");
  if (!describeGroup(groupId)) throw new SavedContactError("groupGone");
  const nameKey = savedNameKey(clean);
  const db = getDb();
  const existing = db.select({ id: savedContacts.id }).from(savedContacts)
    .where(and(eq(savedContacts.userId, userId), eq(savedContacts.nameKey, nameKey))).get();
  const row = db.insert(savedContacts).values({ userId, name: clean, nameKey, groupId })
    .onConflictDoUpdate({ target: [savedContacts.userId, savedContacts.nameKey], set: { name: clean, groupId } })
    .returning({ id: savedContacts.id }).get();
  return { id: row.id, name: clean, created: !existing };
}

/** Removes one of this user's saved people; false if it was not theirs or is already gone. */
export function removeSavedContact(userId: string, id: number): boolean {
  return getDb().delete(savedContacts)
    .where(and(eq(savedContacts.id, id), eq(savedContacts.userId, userId))).run().changes > 0;
}
