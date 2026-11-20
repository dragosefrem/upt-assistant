import { getUser } from "@/lib/auth";
import { currentSemester, eventsBetween, teachingWeek } from "@/lib/schedule";
import { addDays, daysBetween } from "@/lib/time";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar events for the signed-in student between two dates (inclusive). */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  let to = url.searchParams.get("to") ?? from;
  if (!ISO.test(from) || !ISO.test(to) || to < from) return Response.json({ error: "Invalid date range" }, { status: 400 });
  if (daysBetween(from, to) > 62) to = addDays(from, 62);
  const semester = currentSemester();
  return Response.json({
    from,
    to,
    teachingWeek: semester ? teachingWeek(semester, from) : null,
    semester: semester ? { academicYear: semester.academicYear, number: semester.number } : null,
    events: eventsBetween(user, from, to),
  });
}
