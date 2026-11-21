"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { unhideClass } from "@/lib/schedule";
import { rotateCalendarFeed, requireOnboardedUser } from "@/lib/auth";

export async function setContactSharing(form: FormData) {
  const user = await requireOnboardedUser();
  const mode = form.get("sharing");
  if (mode !== "details" && mode !== "availability") return;
  getDb().update(users).set({ shareActivityDetails: mode === "details" }).where(eq(users.id, user.id)).run();
  revalidatePath("/settings");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${user.id}/schedule`);
}

export async function renewCalendarLink() {
  const user = await requireOnboardedUser();
  rotateCalendarFeed(user.id);
  revalidatePath("/settings");
  return true;
}

export async function restoreHiddenClass(entryId: number) {
  const user = await requireOnboardedUser();
  unhideClass(user.id, entryId);
  revalidatePath("/");
  revalidatePath("/settings");
}
