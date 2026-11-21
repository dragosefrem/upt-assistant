import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { previewRequest, reviewTime } from "@/lib/assistant/preview";

/** Review a time picked in chat. Calendar writes happen when the student accepts. */
export async function POST(request: Request) {
  const t = (await getT()).assistant;
  const user = await getUser();
  if (!user) return Response.json({ error: t.api.notSignedIn }, { status: 401 });
  const parsed = previewRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t.preview.invalidTime }, { status: 400 });
  const result = reviewTime(user, parsed.data, await getLocale());
  return Response.json(result, { status: result.ok ? 200 : result.status });
}
