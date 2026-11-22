import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { entries, entryGroups, occurrenceOverrides, personalEvents, userOverrides } from "@/db/schema";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { queueGoogleSync } from "@/lib/google-worker";
import { resetGoogleClass } from "@/lib/google-schedule";
import { editedInterval, personalTimes } from "@/lib/calendar-timing";
import { respondToSponsoredEvent } from "@/lib/sponsored-events";
import { setUptSubscription } from "@/lib/upt-events";

/** A student's personal changes to their own timetable. */
const personal = {
  title: z.string().trim().min(1).max(1024),
  location: z.string().trim().max(2048).optional(),
  date: z.iso.date().optional(), endDate: z.iso.date().optional(),
  day: z.number().int().min(1).max(7).optional(),
  startMin: z.number().int().min(0).max(1439).optional(), endMin: z.number().int().min(0).max(1440).optional(),
  allDay: z.boolean().optional(),
};
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
  z.object({ action: z.literal("addPersonal"), ...personal }),
  z.object({ action: z.literal("updatePersonal"), id: z.number().int(), ...personal }),
  z.object({ action: z.literal("deletePersonal"), id: z.number().int() }),
  z.object({ action: z.literal("sponsored"), id: z.hash("sha256"), choice: z.enum(["save", "hide", "undoHide", "remove"]) }),
  z.object({ action: z.literal("uptSubscription"), subscribed: z.boolean() }),
]);

export async function POST(request: Request) {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: t.calendar.api.invalidRequest }, { status: 400 });
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
    case "uptSubscription":
      setUptSubscription(user.id, body.subscribed);
      break;
    case "sponsored":
      if (!respondToSponsoredEvent(user.id, body.id, body.choice)) {
        return Response.json({ error: t.sponsored.errors.unavailable }, { status: 409 });
      }
      break;
    case "hide":
    case "move": {
      if (!ownsEntry(body.entryId)) return Response.json({ error: t.calendar.api.unknownClass }, { status: 404 });
      if (body.action === "move" && body.endMin <= body.startMin) return Response.json({ error: t.calendar.api.endAfterStart }, { status: 400 });
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
        resetGoogleClass(user.id, body.entryId);
        db.delete(userOverrides)
          .where(and(eq(userOverrides.userId, user.id), body.entryId ? eq(userOverrides.entryId, body.entryId) : undefined))
          .run();
      }
      break;
    case "addPersonal":
    case "updatePersonal": {
      const where = body.action === "updatePersonal" ? and(eq(personalEvents.id, body.id), eq(personalEvents.userId, user.id)) : undefined;
      const existing = where ? db.select().from(personalEvents).where(where).get() : undefined;
      if (where && !existing) return Response.json({ error: t.settings.export.errors.notFound }, { status: 404 });
      const details = { title: body.title, location: body.location || null };
      if (where && !body.date && !body.day && body.startMin === undefined && body.endMin === undefined) {
        db.update(personalEvents).set(details).where(where).run();
        break;
      }
      if (!!body.date === !!body.day || body.startMin === undefined || body.endMin === undefined) {
        return Response.json({ error: t.calendar.api.dateOrDay }, { status: 400 });
      }
      const endDate = body.endDate ?? body.date;
      const multiDay = !!(body.date && endDate && endDate > body.date);
      if ((endDate && body.date && endDate < body.date) || (!body.allDay && !multiDay && body.endMin <= body.startMin)
        || (!body.date && (body.allDay || body.endDate))) return Response.json({ error: t.calendar.api.endAfterStart }, { status: 400 });
      const calendarTiming = body.date && endDate && (body.allDay || multiDay || existing?.calendarTiming)
        ? editedInterval(body.date, endDate, body.startMin, body.endMin, !!body.allDay, existing?.calendarTiming) : null;
      const row = { ...details, calendarTiming, ...(calendarTiming ? personalTimes(calendarTiming)
        : { date: body.date ?? null, day: body.day ?? null, startMin: body.startMin, endMin: body.endMin }) };
      if (where) db.update(personalEvents).set(row).where(where).run();
      else db.insert(personalEvents).values({ userId: user.id, ...row }).run();
      break;
    }
    case "deletePersonal":
      db.delete(personalEvents).where(and(eq(personalEvents.id, body.id), eq(personalEvents.userId, user.id))).run();
      break;
  }
  if (user.googleRefreshToken) queueGoogleSync(user.id);
  return Response.json({ ok: true });
}

/** Hidden and moved classes, for the "your changes" list. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  const rows = getDb().select().from(userOverrides).where(eq(userOverrides.userId, user.id)).all();
  return Response.json({ overrides: rows });
}
