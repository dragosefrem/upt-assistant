import type { EntryKind } from "@/db/schema";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { makeupSessions } from "@/lib/labs";
import { addDays, nowLocal, weekday } from "@/lib/time";

const KINDS = new Set(["lab", "seminar", "project"]);

/**
 * Other groups' sessions of one of the student's labs (or seminars, projects), from today
 * to the end of next week. Query: course (name or acronym), kind (optional).
 */
export async function GET(request: Request) {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  const url = new URL(request.url);
  const course = (url.searchParams.get("course") ?? "").trim().slice(0, 200);
  const kind = url.searchParams.get("kind") ?? "";
  if (!course) return Response.json({ error: t.study.makeup.failed }, { status: 400 });
  const from = nowLocal().date;
  const to = addDays(from, 14 - weekday(from));
  const found = makeupSessions(user, { course, kind: KINDS.has(kind) ? (kind as EntryKind) : undefined, from, to });
  if (!found.ok) return Response.json({ sessions: [], own: [], course, from, to });
  return Response.json({ ...found.result, from, to });
}
