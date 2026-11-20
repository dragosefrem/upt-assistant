"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { groups, specializations, userCourses, userOverrides, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { courseChoices, currentSemester } from "@/lib/schedule";

export interface ProfileState {
  error?: string;
}

/** Saves faculty, specialization, year and group, then moves on to course choices. */
export async function saveProfileAction(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const db = getDb();
  const facultyId = Number(form.get("facultyId"));
  const specializationId = Number(form.get("specializationId"));
  const year = Number(form.get("year"));
  const groupId = form.get("groupId") ? Number(form.get("groupId")) : null;

  const spec = db.select().from(specializations).where(eq(specializations.id, specializationId)).get();
  if (!spec || spec.facultyId !== facultyId) return { error: "Choose your faculty and specialization." };
  if (!Number.isInteger(year) || year < 1 || year > 6) return { error: "Choose your year of study." };
  if (groupId !== null) {
    const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
    if (!group || group.specializationId !== specializationId || group.year !== year) {
      return { error: "That group does not belong to the chosen specialization and year." };
    }
  }

  if (groupId !== user.groupId) {
    // Course picks and personal changes refer to the old group's timetable.
    db.delete(userCourses).where(eq(userCourses.userId, user.id)).run();
    db.delete(userOverrides).where(eq(userOverrides.userId, user.id)).run();
  }
  db.update(users).set({ facultyId, specializationId, year, groupId }).where(eq(users.id, user.id)).run();

  const semester = currentSemester();
  const needsChoices =
    !!semester && courseChoices({ id: user.id, groupId, year }, semester).some((c) => c.selectable || c.slots.length > 0);
  if (needsChoices) redirect("/onboarding/courses");

  db.update(users).set({ onboardedAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();
  revalidatePath("/", "layout");
  redirect("/");
}

/** Saves which courses the student follows and which lab slot they attend. */
export async function saveCoursesAction(form: FormData) {
  const user = await requireUser();
  const db = getDb();
  const semester = currentSemester();
  if (semester) {
    for (const c of courseChoices(user, semester)) {
      if (!c.selectable && !c.slots.length) continue;
      const enrolled = c.selectable ? form.get(`enrolled-${c.courseId}`) === "on" : true;
      const slot = Number(form.get(`slot-${c.courseId}`));
      const slotEntryId = enrolled && c.slots.some((s) => s.entryId === slot) ? slot : null;
      db.insert(userCourses)
        .values({ userId: user.id, courseId: c.courseId, enrolled, slotEntryId })
        .onConflictDoUpdate({ target: [userCourses.userId, userCourses.courseId], set: { enrolled, slotEntryId } })
        .run();
    }
  }
  const first = !user.onboardedAt;
  if (first) db.update(users).set({ onboardedAt: new Date().toISOString() }).where(and(eq(users.id, user.id))).run();
  revalidatePath("/", "layout");
  redirect(first ? "/" : String(form.get("returnTo") ?? "/settings"));
}
