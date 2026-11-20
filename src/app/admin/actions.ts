"use server";

import { revalidatePath } from "next/cache";
import { eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, semesters, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export async function setCurrentSemesterAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("semesterId"));
  const db = getDb();
  if (!db.select().from(semesters).where(eq(semesters.id, id)).get()) return;
  db.transaction((tx) => {
    tx.update(semesters).set({ isCurrent: false }).where(ne(semesters.id, id)).run();
    tx.update(semesters).set({ isCurrent: true }).where(eq(semesters.id, id)).run();
  });
  revalidatePath("/", "layout");
}

export async function setCourseOptionalAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("courseId"));
  const isOptional = form.get("isOptional") === "true";
  getDb().update(courses).set({ isOptional }).where(eq(courses.id, id)).run();
  revalidatePath("/", "layout");
}

export async function setUserRoleAction(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("userId"));
  const role = form.get("role") === "admin" ? "admin" : "student";
  // An admin cannot demote themselves, so there is always at least one left.
  if (id === admin.id) return;
  getDb().update(users).set({ role }).where(eq(users.id, id)).run();
  revalidatePath("/admin");
}
