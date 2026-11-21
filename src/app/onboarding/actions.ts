"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userCourses, users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { courseChoices, currentSemester } from "@/lib/schedule";
import { applyStudyProfile, profileError } from "@/lib/study-profile";

export interface ProfileState {
  error?: string;
}

function courseReturnPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\p{Cc}]/u.test(value)) return "/settings";
  const path = new URL(value, "https://upt.invalid");
  // Removing dot segments can produce a leading double slash even for a local input.
  return path.pathname.startsWith("//") ? "/settings" : path.pathname + path.search + path.hash;
}

/** Saves faculty, specialization, year and group, then moves on to course choices. */
export async function saveProfileAction(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const user = await requireUser();
  const t = (await getT()).onboarding.profile.errors;
  const db = getDb();
  const facultyId = Number(form.get("facultyId"));
  const specializationId = Number(form.get("specializationId"));
  const year = Number(form.get("year"));
  const groupId = form.get("groupId") ? Number(form.get("groupId")) : null;

  const profile = { facultyId, specializationId, year, groupId };
  const error = profileError(profile);
  if (error) return { error: t[error] };
  applyStudyProfile(user, profile);

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
  redirect(first ? "/" : courseReturnPath(form.get("returnTo")));
}

/** The welcome tour was finished or skipped: do not show it again. */
export async function finishWelcomeAction() {
  const user = await requireUser();
  if (!user.welcomeSeenAt) getDb().update(users).set({ welcomeSeenAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();
  revalidatePath("/", "layout");
}
