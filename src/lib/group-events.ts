import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { eventParticipants, groupEvents, users, type EventStatus, type Rsvp } from "@/db/schema";
import { InvitationError } from "./contacts";
import { nowLocal } from "./time";

const goingCount = sql<number>`(select count(*) from ${eventParticipants}
  where ${eventParticipants.eventId} = ${groupEvents.id} and ${eventParticipants.response} = 'accepted')`;

/** The cutoff takes effect on every read, even if the server was offline at the
 * deadline. A later RSVP freezes this outcome before changing the headcount. */
function effectiveStatus(now: number) {
  return sql<EventStatus>`case when ${groupEvents.status} <> 'pending' then ${groupEvents.status}
    when ${groupEvents.deadline} > ${now} then 'pending'
    when ${goingCount} >= 2 then 'confirmed' else 'expired' end`;
}

const eventFields = {
  id: groupEvents.id, title: groupEvents.title, location: groupEvents.location,
  date: groupEvents.date, startMin: groupEvents.startMin, endMin: groupEvents.endMin,
  deadline: groupEvents.deadline, creatorId: groupEvents.creatorId, host: users.name,
};

export function myGroupEvents(userId: string) {
  return getDb().select({ ...eventFields, status: effectiveStatus(Date.now()), going: goingCount, response: eventParticipants.response })
    .from(groupEvents).innerJoin(users, eq(users.id, groupEvents.creatorId))
    .innerJoin(eventParticipants, eq(eventParticipants.eventId, groupEvents.id))
    .where(eq(eventParticipants.userId, userId)).orderBy(asc(groupEvents.date), asc(groupEvents.startMin)).all();
}

export function groupInviteCount(userId: string) {
  return getDb().select({ n: count() }).from(eventParticipants)
    .innerJoin(groupEvents, eq(groupEvents.id, eventParticipants.eventId))
    .where(and(eq(eventParticipants.userId, userId), eq(eventParticipants.response, "pending"),
      gte(groupEvents.date, nowLocal().date), ne(effectiveStatus(Date.now()), "expired"))).get()!.n;
}

function eventSummary(where: SQL) {
  return getDb().select({ ...eventFields, status: effectiveStatus(Date.now()), going: goingCount, shareToken: groupEvents.shareToken })
    .from(groupEvents).innerJoin(users, eq(users.id, groupEvents.creatorId)).where(where).get();
}

export function memberEvent(userId: string, eventId: string) {
  const db = getDb();
  const seat = db.select({ response: eventParticipants.response }).from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.userId, userId))).get();
  if (!seat) return null;
  const event = eventSummary(eq(groupEvents.id, eventId))!;
  const roster = db.select({
    id: eventParticipants.id, name: sql<string>`coalesce(${users.name}, ${eventParticipants.guestName})`, response: eventParticipants.response,
  }).from(eventParticipants).leftJoin(users, eq(users.id, eventParticipants.userId))
    .where(eq(eventParticipants.eventId, eventId)).orderBy(asc(eventParticipants.id)).all();
  return { ...event, shareToken: userId === event.creatorId ? event.shareToken : null, response: seat.response, roster };
}

const guestHash = (key: string) => createHash("sha256").update(key).digest("hex");

export function publicEvent(token: string, userId?: string, guestKey?: string) {
  const event = eventSummary(eq(groupEvents.shareToken, token));
  if (!event) return null;
  const db = getDb();
  const seat = (identity: SQL) => db.select({ response: eventParticipants.response }).from(eventParticipants)
    .where(and(eq(eventParticipants.eventId, event.id), identity)).get();
  const account = userId ? seat(eq(eventParticipants.userId, userId)) : undefined;
  const guest = guestKey ? seat(eq(eventParticipants.guestKeyHash, guestHash(guestKey))) : undefined;
  return { ...event, response: account?.response ?? guest?.response ?? null, accountParticipant: !!account };
}

/** Only current attendees of a confirmed event see it on their calendars. */
export function sharedEventsFor(userId: string, from?: string, to?: string) {
  return getDb().select({
    id: groupEvents.id, title: groupEvents.title, location: groupEvents.location,
    date: groupEvents.date, startMin: groupEvents.startMin, endMin: groupEvents.endMin,
  }).from(eventParticipants).innerJoin(groupEvents, eq(groupEvents.id, eventParticipants.eventId))
    .where(and(eq(eventParticipants.userId, userId), eq(eventParticipants.response, "accepted"),
      eq(effectiveStatus(Date.now()), "confirmed"), gte(goingCount, 2),
      from ? gte(groupEvents.date, from) : undefined, to ? lte(groupEvents.date, to) : undefined)).all();
}

/** Accepted proposals also reserve a person's time while the group is forming. */
export function tentativeTimesFor(userId: string, from: string, to: string) {
  return getDb().select({ date: groupEvents.date, startMin: groupEvents.startMin, endMin: groupEvents.endMin })
    .from(eventParticipants).innerJoin(groupEvents, eq(groupEvents.id, eventParticipants.eventId))
    .where(and(eq(eventParticipants.userId, userId), eq(eventParticipants.response, "accepted"),
      eq(effectiveStatus(Date.now()), "pending"), gte(groupEvents.date, from), lte(groupEvents.date, to))).all();
}

type Invite = { eventId: string } | { shareToken: string };
type Respondent = { userId: string; guestKey?: string } | { userId?: undefined; guestKey: string; name: string };

export function respondToEvent(invite: Invite, who: Respondent, response: Exclude<Rsvp, "pending">) {
  if (response !== "accepted" && response !== "declined") throw new InvitationError("Choose a response.");
  const publicLink = "shareToken" in invite;
  const saved = getDb().transaction((tx) => {
    const event = tx.select({ id: groupEvents.id, status: groupEvents.status, outcome: effectiveStatus(Date.now()) }).from(groupEvents)
      .where(publicLink ? eq(groupEvents.shareToken, invite.shareToken) : eq(groupEvents.id, invite.eventId)).get();
    if (!event) throw new InvitationError("This invitation is unavailable.");
    const seat = (identity: SQL) => tx.select().from(eventParticipants)
      .where(and(eq(eventParticipants.eventId, event.id), identity)).get();
    const account = who.userId ? seat(eq(eventParticipants.userId, who.userId)) : undefined;
    if (!publicLink && !account) throw new InvitationError("This invitation is unavailable.");
    const hash = publicLink && who.guestKey ? guestHash(who.guestKey) : null;
    const guest = hash ? seat(eq(eventParticipants.guestKeyHash, hash)) : undefined;

    if (event.outcome !== event.status) {
      tx.update(groupEvents).set({ status: event.outcome }).where(eq(groupEvents.id, event.id)).run();
    }
    if (event.outcome === "expired") return false;

    if (who.userId !== undefined) {
      // A guest who later signs in keeps one seat, including any original invitation.
      if (guest) tx.delete(eventParticipants).where(eq(eventParticipants.id, guest.id)).run();
      tx.insert(eventParticipants).values({ eventId: event.id, userId: who.userId, response })
        .onConflictDoUpdate({ target: [eventParticipants.userId, eventParticipants.eventId], set: { response } }).run();
    } else if (guest) {
      tx.update(eventParticipants).set({ response }).where(eq(eventParticipants.id, guest.id)).run();
    } else {
      const name = who.name.trim();
      if (!name || name.length > 100 || !hash) throw new InvitationError("Enter a name of up to 100 characters.");
      tx.insert(eventParticipants).values({ eventId: event.id, guestName: name, guestKeyHash: hash, response }).run();
    }

    if (event.outcome === "pending") {
      const members = tx.select({ invited: eventParticipants.invited, response: eventParticipants.response })
        .from(eventParticipants).where(eq(eventParticipants.eventId, event.id)).all();
      if (members.filter((m) => m.response === "accepted").length >= 2
          && members.every((m) => !m.invited || m.response === "accepted")) {
        tx.update(groupEvents).set({ status: "confirmed" }).where(eq(groupEvents.id, event.id)).run();
      }
    }
    return true;
  }, { behavior: "immediate" });
  if (!saved) throw new InvitationError("This invitation expired with fewer than two people going.");
}
