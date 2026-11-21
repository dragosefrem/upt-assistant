import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { studentNotifications } from "@/lib/notifications";

export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  return Response.json(studentNotifications(user, await getLocale()), { headers: { "Cache-Control": "private, no-store" } });
}
