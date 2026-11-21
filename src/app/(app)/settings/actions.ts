"use server";

import { revalidatePath } from "next/cache";
import { unhideClass } from "@/lib/schedule";
import { rotateCalendarFeed, requireOnboardedUser } from "@/lib/auth";

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
