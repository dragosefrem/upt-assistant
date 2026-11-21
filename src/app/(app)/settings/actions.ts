"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { newFeedToken, requireOnboardedUser } from "@/lib/auth";

export async function renewCalendarLink() {
  const user = await requireOnboardedUser();
  getDb().update(users).set({ feedToken: newFeedToken() }).where(eq(users.id, user.id)).run();
  revalidatePath("/settings");
  return true;
}
