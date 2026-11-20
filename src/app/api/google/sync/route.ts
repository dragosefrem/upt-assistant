import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { GoogleError, syncToGoogle } from "@/lib/google";

/** Re-exports the timetable to the student's Google calendar. */
export async function POST() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const result = await syncToGoogle(user);
    return Response.json({ ok: true, events: result.events });
  } catch (err) {
    const message = err instanceof GoogleError ? err.message : "Google Calendar could not be reached.";
    if (!(err instanceof GoogleError)) console.error("Google sync failed", err);
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Disconnects Google. The calendar already in Google is left as it is. */
export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  getDb().update(users).set({ googleRefreshToken: null, googleCalendarId: null, googleSyncedAt: null }).where(eq(users.id, user.id)).run();
  return Response.json({ ok: true });
}
