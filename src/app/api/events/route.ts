import { z } from "zod";
import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { holidaysBetween } from "@/lib/holidays";
import { currentSemester, eventsBetween, teachingWeek } from "@/lib/schedule";
import { calendarWithOffers } from "@/lib/sponsored-events";
import { addDays, daysBetween } from "@/lib/time";

const isoDate = z.iso.date();

/** Calendar events for the signed-in student between two dates (inclusive), with notes in the request's language. */
export async function GET(request: Request) {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  let to = url.searchParams.get("to") ?? from;
  if (!isoDate.safeParse(from).success || !isoDate.safeParse(to).success || to < from) return Response.json({ error: t.calendar.api.invalidRange }, { status: 400 });
  if (daysBetween(from, to) > 62) to = addDays(from, 62);
  const semester = currentSemester();
  const locale = await getLocale();
  return Response.json({
    from,
    to,
    teachingWeek: semester ? teachingWeek(semester, from) : null,
    semester: semester ? { academicYear: semester.academicYear, number: semester.number } : null,
    holidays: holidaysBetween(from, to, locale),
    ...(url.searchParams.get("offers") === "1" ? calendarWithOffers(user, from, to, locale) : { events: eventsBetween(user, from, to, locale) }),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
