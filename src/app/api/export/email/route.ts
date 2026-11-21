import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { emailCalendar } from "@/lib/export-email";

/**
 * E-mails the signed-in student their calendar as an .ics attachment. Body: {"email"?: string}.
 * The e-mail is in the account's language, else the language of this request.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : undefined;
  const result = await emailCalendar(user, email, undefined, user.locale ?? (await getLocale()));
  return result.ok ? Response.json({ sentTo: result.sentTo }) : Response.json({ error: result.error }, { status: result.status });
}
