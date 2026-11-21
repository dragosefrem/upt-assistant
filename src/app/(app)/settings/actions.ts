"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userOverrides, users } from "@/db/schema";
import { newFeedToken, requireOnboardedUser } from "@/lib/auth";

export async function renewCalendarLink() {
  const user = await requireOnboardedUser();
  getDb().update(users).set({ feedToken: newFeedToken() }).where(eq(users.id, user.id)).run();
  revalidatePath("/settings");
  return true;
}

export async function restoreHiddenClass(entryId: number) {
  const user = await requireOnboardedUser();
  const ownClass = and(eq(userOverrides.userId, user.id), eq(userOverrides.entryId, entryId), eq(userOverrides.hidden, true));
  getDb().update(userOverrides).set({ hidden: false, updatedAt: new Date().toISOString() }).where(ownClass).run();
  revalidatePath("/");
  revalidatePath("/settings");
}
