import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { entries, entryGroups, occurrenceOverrides, personalEvents, userOverrides } from "@/db/schema";
import { getUser } from "@/lib/auth";

/** A student's personal changes to their own timetable. */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("hide"), entryId: z.number().int() }),
  z.object({
    action: z.literal("move"),
    entryId: z.number().int(),
    day: z.number().int().min(1).max(7),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
    room: z.string().trim().max(60).optional(),
  }),
  z.object({
    action: z.literal("reset"),
    entryId: z.number().int().optional(),
    // Undo a one-week move only: the date the class normally takes place on.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  z.object({
    action: z.literal("addPersonal"),
    title: z.string().trim().min(1).max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    day: z.number().int().min(1).max(7).optional(),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
    location: z.string().trim().max(120).optional(),
  }),
  z.object({ action: z.literal("deletePersonal"), id: z.number().int() }),
]);

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const db = getDb();

  // Overrides may only target entries of the student's own group.
  const ownsEntry = (entryId: number) =>
    !!user.groupId &&
    !!db
      .select({ id: entries.id })
      .from(entryGroups)
      .innerJoin(entries, eq(entries.id, entryGroups.entryId))
      .where(and(eq(entryGroups.entryId, entryId), eq(entryGroups.groupId, user.groupId)))
      .get();

  switch (body.action) {
    case "hide":
    case "move": {
      if (!ownsEntry(body.entryId)) return Response.json({ error: "Unknown class" }, { status: 404 });
      if (body.action === "move" && body.endMin <= body.startMin) return Response.json({ error: "End must be after start" }, { status: 400 });
      const patch =
        body.action === "hide"
          ? { hidden: true }
          : { hidden: false, day: body.day, startMin: body.startMin, endMin: body.endMin, room: body.room || null };
      db.insert(userOverrides)
        .values({ userId: user.id, entryId: body.entryId, ...patch })
        .onConflictDoUpdate({ target: [userOverrides.userId, userOverrides.entryId], set: { ...patch, updatedAt: new Date().toISOString() } })
        .run();
      break;
    }
    case "reset":
      db.delete(occurrenceOverrides)
        .where(
          and(
            eq(occurrenceOverrides.userId, user.id),
            body.entryId ? eq(occurrenceOverrides.entryId, body.entryId) : undefined,
            body.date ? eq(occurrenceOverrides.date, body.date) : undefined,
          ),
        )
        .run();
      // Undoing a one-week move leaves the weekly arrangement alone.
      if (!body.date) {
        db.delete(userOverrides)
          .where(and(eq(userOverrides.userId, user.id), body.entryId ? eq(userOverrides.entryId, body.entryId) : undefined))
          .run();
      }
      break;
    case "addPersonal":
      if (body.endMin <= body.startMin) return Response.json({ error: "End must be after start" }, { status: 400 });
      if (!body.date && !body.day) return Response.json({ error: "A date or a weekday is required" }, { status: 400 });
      db.insert(personalEvents)
        .values({
          userId: user.id,
          title: body.title,
          date: body.date ?? null,
          day: body.date ? null : body.day!,
          startMin: body.startMin,
          endMin: body.endMin,
          location: body.location || null,
        })
        .run();
      break;
    case "deletePersonal":
      db.delete(personalEvents).where(and(eq(personalEvents.id, body.id), eq(personalEvents.userId, user.id))).run();
      break;
  }
  return Response.json({ ok: true });
}

/** Hidden and moved classes, for the "your changes" list. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const rows = getDb().select().from(userOverrides).where(eq(userOverrides.userId, user.id)).all();
  return Response.json({ overrides: rows });
}
