import "server-only";
import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { contacts as contactTexts, type ContactsErrorCode } from "@/i18n/messages/contacts";
import { normalizeEmail } from "./auth";

/**
 * Expected input or permission errors that an invitation form can display. `code` names
 * the text in `contacts.errors`; `message` is its English version, for logs and tests.
 */
export class InvitationError extends Error {
  constructor(readonly code: ContactsErrorCode) {
    super(contactTexts.en.errors[code]);
    this.name = "InvitationError";
  }
}

/** The form result for an expected error, in the visitor's language; anything else is rethrown. */
export function invitationFailure(error: unknown, locale: Locale = "en") {
  if (error instanceof InvitationError) return { error: contactTexts[locale].errors[error.code] };
  throw error;
}

const person = { id: users.id, name: users.name, email: users.email };

export function findPerson(email: string) {
  return getDb().select(person).from(users).where(eq(users.email, normalizeEmail(email))).get();
}

/** Use the same address format that registration accepts. */
export function lookupContact(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return { error: "invalidEmail" } as const;
  const person = findPerson(email);
  return person ? { person } : { error: "noAccount" } as const;
}

const involving = (id: string) => or(eq(contacts.firstId, id), eq(contacts.secondId, id));
const otherUser = (id: string) => eq(users.id, sql`case when ${contacts.firstId} = ${id} then ${contacts.secondId} else ${contacts.firstId} end`);

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
    .innerJoin(users, otherUser(userId))
    .where(involving(userId)).orderBy(asc(users.name), asc(users.email)).all();
}

/** The calendar profiles this viewer is allowed to look up. */
export function acceptedScheduleContacts(viewerId: string, ids?: string[]) {
  if (ids?.length === 0) return [];
  return getDb().select({
    id: users.id, name: users.name, groupId: users.groupId, facultyId: users.facultyId,
    specializationId: users.specializationId, year: users.year, shareActivityDetails: users.shareActivityDetails,
  }).from(contacts).innerJoin(users, otherUser(viewerId))
    .where(and(involving(viewerId), eq(contacts.accepted, true), ids ? inArray(users.id, ids) : undefined)).all();
}

export type ScheduleContact = ReturnType<typeof acceptedScheduleContacts>[number];

export function incomingContactCount(userId: string) {
  return getDb().select({ n: count() }).from(contacts)
    .where(and(involving(userId), eq(contacts.accepted, false), ne(contacts.requestedBy, userId))).get()!.n;
}

export function inviteContact(userId: string, email: string) {
  const { person: recipient, error } = lookupContact(email);
  if (error) throw new InvitationError(error);
  if (recipient.id === userId) throw new InvitationError("notYourself");
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
