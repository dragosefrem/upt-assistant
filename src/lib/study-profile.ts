import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { occurrenceOverrides, userCourses, userOverrides, users } from "@/db/schema";
import type { User } from "./auth";
import { pickerData } from "./catalog";
import { programmeOptions } from "./profile-options";

export type StudyProfile = { facultyId: number; specializationId: number; year: number; groupId: number | null };

export function profileError({ facultyId, specializationId, year, groupId }: StudyProfile) {
  const data = pickerData();
  const spec = data.specializations.find((s) => s.id === specializationId);
  if (!spec || spec.facultyId !== facultyId) return "programme";
  if (!Number.isInteger(year) || year < 1 || year > 6) return "year";
  const { scheduled, other } = programmeOptions(data.specializations, data.groups, year);
  if (![...scheduled, ...other].includes(spec)) return "offered";
  const available = data.groups.filter((g) => g.specializationId === specializationId && g.year === year);
  if ((available.length || groupId !== null) && !available.some((g) => g.id === groupId)) {
    return "group";
  }

  return null;
}

export function applyStudyProfile(user: User, profile: StudyProfile) {
  getDb().transaction(tx => {
    const current = tx.select({ groupId: users.groupId }).from(users).where(eq(users.id, user.id)).get();
    if (current?.groupId !== profile.groupId) {
      tx.delete(userCourses).where(eq(userCourses.userId, user.id)).run();
      tx.delete(userOverrides).where(eq(userOverrides.userId, user.id)).run();
      tx.delete(occurrenceOverrides).where(eq(occurrenceOverrides.userId, user.id)).run();
    }
    // A new group means a new timetable for the student to check.
    const reset = current?.groupId !== profile.groupId ? { timetableConfirmedAt: null } : {};
    tx.update(users).set({ ...profile, ...reset }).where(eq(users.id, user.id)).run();
  });
}
