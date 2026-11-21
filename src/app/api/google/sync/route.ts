import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { GoogleError, syncToGoogle } from "@/lib/google";

/** Re-exports the timetable to the student's Google calendar. */
export async function POST() {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  try {
    const result = await syncToGoogle(user, user.locale ?? (await getLocale()));
    return Response.json({ ok: true, events: result.events });
  } catch (err) {
    const g = t.settings.export.google;
    const message = err instanceof GoogleError ? (err.known ? err.message : g.replied(err.message)) : g.unreachable;
    if (!(err instanceof GoogleError)) console.error("Google sync failed", err);
    return Response.json({ error: message }, { status: 502 });
  }
}

/** Disconnects Google. The calendar already in Google is left as it is. */
export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  getDb().update(users).set({ googleRefreshToken: null, googleCalendarId: null, googleSyncedAt: null }).where(eq(users.id, user.id)).run();
  return Response.json({ ok: true });
}
