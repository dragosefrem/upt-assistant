import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { isGoogleSyncMode } from "@/lib/calendar-types";
import { disconnectGoogle, GoogleError, setGoogleSyncMode, syncToGoogle } from "@/lib/google";

/** Synchronizes the dedicated calendar in the account’s selected direction. */
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
    return Response.json({ error: message }, { status: err instanceof GoogleError && err.known ? err.status ?? 502 : 502 });
  }
}

/** Save the direction before consent or for an existing calendar. */
export async function PATCH(request: Request) {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!isGoogleSyncMode(body?.mode)) return Response.json({ error: t.settings.export.google.invalidMode }, { status: 400 });
  setGoogleSyncMode(user.id, body.mode);
  return Response.json({ mode: body.mode });
}

/** Disconnects Google. The calendar already in Google is left as it is. */
export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  disconnectGoogle(user.id);
  return Response.json({ ok: true });
}
