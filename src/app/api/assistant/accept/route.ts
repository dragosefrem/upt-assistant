import { acceptPreview } from "@/lib/assistant/accept";
import { getUser } from "@/lib/auth";

/** Accepts the calendar change previewed in the student's latest assistant message. Body: {"id": messageId}. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return Response.json({ error: "Missing message id" }, { status: 400 });
  const result = await acceptPreview(user, id);
  return result.ok
    ? Response.json({ reply: result.reply, changed: result.changed })
    : Response.json({ error: result.error }, { status: result.status });
}
