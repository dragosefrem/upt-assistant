"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userCourses, userOverrides, users } from "@/db/schema";
import { requireOnboardedUser } from "@/lib/auth";
import { queueGoogleSync } from "@/lib/google-worker";
import { addExtraCourse, currentSemester, removeExtraCourse, timetableReview, unhideClass } from "@/lib/schedule";

const PAGE = "/timetable-settings";

function refresh(user: { id: string; googleRefreshToken: string | null }) {
  if (user.googleRefreshToken) queueGoogleSync(user.id);
  revalidatePath("/", "layout");
}

/**
 * Saves the timetable review: which courses the student follows, which sessions of each are
 * in their timetable and which lab slot they attend. Only courses and sessions that were on
 * the submitted form change, so a timetable updated in the meantime keeps its new classes.
 */
export async function saveTimetableAction(form: FormData) {
  const user = await requireOnboardedUser();
  const semester = currentSemester();
  const db = getDb();
  const confirm = form.get("confirm") === "1";
  if (!semester || !user.groupId) redirect(PAGE);
  db.transaction((tx) => {
    for (const c of timetableReview(user, semester)) {
      if (form.get(`course-${c.courseId}`) !== "1") continue;
      const enrolled = form.get(`enrolled-${c.courseId}`) === "on";
      const slot = form.get(`slot-${c.courseId}`);
      let slotEntryId = c.chosenSlotId;
      if (enrolled && slot !== null) {
        const chosen = c.slots.find((s) => s.entryId === Number(slot));
        if (chosen) {
          slotEntryId = chosen.entryId;
          if (c.hiddenSlotIds.includes(chosen.entryId)) unhideClass(user.id, chosen.entryId);
        } else if (slot === "" && !c.hiddenSlotIds.includes(slotEntryId ?? 0)) {
          slotEntryId = null;
        }
      }
      tx.insert(userCourses)
        .values({ userId: user.id, courseId: c.courseId, enrolled, slotEntryId })
        .onConflictDoUpdate({ target: [userCourses.userId, userCourses.courseId], set: { enrolled, slotEntryId } })
        .run();
      // An unticked course leaves the timetable whole; its sessions keep their own ticks for later.
      if (!enrolled) continue;
      for (const a of c.activities) {
        if (form.get(`entry-${a.entryId}`) !== "1") continue;
        const keep = form.get(`keep-${a.entryId}`) === "on";
        if (keep && a.hidden) unhideClass(user.id, a.entryId);
        if (!keep && !a.hidden) {
          tx.insert(userOverrides)
            .values({ userId: user.id, entryId: a.entryId, hidden: true })
            .onConflictDoUpdate({ target: [userOverrides.userId, userOverrides.entryId], set: { hidden: true, updatedAt: new Date().toISOString() } })
            .run();
        }
      }
    }
    if (confirm) tx.update(users).set({ timetableConfirmedAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();
  });
  refresh(user);
  redirect(`${PAGE}?saved=${confirm ? "confirmed" : "1"}#courses`);
}

/** Adds a course taught to another group, following that group's sessions. */
export async function addExtraCourseAction(form: FormData) {
  const user = await requireOnboardedUser();
  const courseId = Number(form.get("courseId"));
  const groupId = Number(form.get("groupId"));
  const added = Number.isInteger(courseId) && Number.isInteger(groupId) && addExtraCourse(user, courseId, groupId);
  if (!added) redirect(`${PAGE}?extra=unavailable#extra`);
  refresh(user);
  redirect(`${PAGE}?extra=added#course-${courseId}`);
}

export async function removeExtraCourseAction(courseId: number) {
  const user = await requireOnboardedUser();
  if (removeExtraCourse(user.id, courseId)) refresh(user);
  redirect(`${PAGE}?extra=removed#courses`);
}
