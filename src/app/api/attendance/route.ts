import { z } from "zod";
import { attendanceRecords, markAttendance } from "@/lib/attendance";
import { getUser } from "@/lib/auth";
import { nowLocal } from "@/lib/time";

/** Marks one occurrence of a calendar event as attended or missed (null clears it). */
const Body = z.object({
  eventId: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["attended", "missed"]).nullable(),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const result = markAttendance(user, parsed.data, nowLocal().date);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, status: result.status });
}

/** Every attendance mark of the signed-in student, newest first. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ records: attendanceRecords(user.id) });
}
