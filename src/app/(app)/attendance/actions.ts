"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { setAttendanceGoal } from "@/lib/attendance-goals";
import { requireOnboardedUser } from "@/lib/auth";

export async function saveAttendanceGoal(activityId: string, minimum: number | null) {
  const user = await requireOnboardedUser();
  const error = setAttendanceGoal(user, activityId, minimum);
  if (error) return { error: (await getT()).attendance.goals[error] };
  revalidatePath("/attendance");
  return { error: null };
}
