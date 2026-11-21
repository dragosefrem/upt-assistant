import { getUser } from "@/lib/auth";
import { everydayTip } from "@/lib/examTips";
import { examReminders } from "@/lib/reminders";
import { nowLocal } from "@/lib/time";

/** Upcoming exam reminders for the signed-in student, for the notification bell. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ reminders: examReminders(user), tip: everydayTip(nowLocal().date) });
}
