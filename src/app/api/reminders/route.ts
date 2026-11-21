import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { everydayTip } from "@/lib/examTips";
import { REMINDER_DAYS, examReminders } from "@/lib/reminders";
import { nowLocal } from "@/lib/time";

/** Upcoming exam reminders for the signed-in student, for the notification bell, in the request's language. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  const locale = await getLocale();
  return Response.json({ reminders: examReminders(user, new Date(), REMINDER_DAYS, locale), tip: everydayTip(nowLocal().date, locale) });
}
