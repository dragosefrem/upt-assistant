import "server-only";
import { and, asc, count, eq, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, users } from "@/db/schema";
import { normalizeEmail } from "./auth";

/** Expected input or permission errors that an invitation form can display. */
export class InvitationError extends Error {}

export function invitationFailure(error: unknown) {
  if (error instanceof InvitationError) return { error: error.message };
  throw error;
}

const person = { id: users.id, name: users.name, email: users.email };

export function findPerson(email: string) {
  return getDb().select(person).from(users).where(eq(users.email, normalizeEmail(email))).get();
}

const involving = (id: string) => or(eq(contacts.firstId, id), eq(contacts.secondId, id));

function pair(first: string, second: string) {
  const [firstId, secondId] = [first, second].sort();
  return { firstId, secondId };
}

function between(a: string, b: string) {
  const { firstId, secondId } = pair(a, b);
  return and(eq(contacts.firstId, firstId), eq(contacts.secondId, secondId));
}

export function contactList(userId: string) {
  return getDb().select({ ...person, accepted: contacts.accepted, requestedBy: contacts.requestedBy })
    .from(contacts)
    .innerJoin(users, eq(users.id, sql`case when ${contacts.firstId} = ${userId} then ${contacts.secondId} else ${contacts.firstId} end`))
    .where(involving(userId)).orderBy(asc(users.name), asc(users.email)).all();
}

export function incomingContactCount(userId: string) {
  return getDb().select({ n: count() }).from(contacts)
    .where(and(involving(userId), eq(contacts.accepted, false), ne(contacts.requestedBy, userId))).get()!.n;
}

export function inviteContact(userId: string, email: string) {
  const recipient = findPerson(email);
  if (!recipient) throw new InvitationError("No account has that e-mail address.");
  if (recipient.id === userId) throw new InvitationError("Enter another person’s e-mail address.");
  getDb().insert(contacts).values({ ...pair(userId, recipient.id), requestedBy: userId })
    .onConflictDoNothing().run();
}

export function answerContact(userId: string, otherId: string, accept: boolean) {
  const incoming = and(between(userId, otherId), eq(contacts.requestedBy, otherId), eq(contacts.accepted, false));
  const db = getDb();
  if (accept) db.update(contacts).set({ accepted: true }).where(incoming).run();
  else db.delete(contacts).where(incoming).run();
}

export function cancelContactRequest(userId: string, otherId: string) {
  getDb().delete(contacts).where(and(between(userId, otherId), eq(contacts.requestedBy, userId), eq(contacts.accepted, false))).run();
}

export function removeContact(userId: string, otherId: string) {
  getDb().delete(contacts).where(and(between(userId, otherId), eq(contacts.accepted, true))).run();
}
