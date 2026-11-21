import { getUser } from "@/lib/auth";
import { emailCalendar } from "@/lib/export-email";

/** E-mails the signed-in student their calendar as an .ics attachment. Body: {"email"?: string}. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : undefined;
  const result = await emailCalendar(user, email);
  return result.ok ? Response.json({ sentTo: result.sentTo }) : Response.json({ error: result.error }, { status: result.status });
}
