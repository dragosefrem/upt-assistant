import "server-only";
import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { contacts, faculties, groups, specializations, users } from "@/db/schema";
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

/** Left joins keep students with incomplete study profiles in name searches and contact lists. */
export function contactProfiles<T extends SelectedFields>(extra: T) {
  return getDb().select({
    id: users.id, name: users.name, year: sql<number | null>`coalesce(${groups.year}, ${users.year})`,
    groupName: groups.name, series: groups.series, faculty: faculties.shortName,
    programme: sql<string | null>`coalesce(${specializations.code}, ${specializations.name})`,
    ...extra,
  }).from(users)
    .leftJoin(groups, eq(groups.id, users.groupId))
    .leftJoin(specializations, eq(specializations.id, sql`coalesce(${groups.specializationId}, ${users.specializationId})`))
    .leftJoin(faculties, eq(faculties.id, sql`coalesce(${specializations.facultyId}, ${users.facultyId})`));
}

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
  return contactProfiles({ email: users.email, accepted: contacts.accepted, requestedBy: contacts.requestedBy })
    .innerJoin(contacts, otherUser(userId))
    .where(involving(userId)).orderBy(sql`fold_name(${users.name})`, asc(users.id)).all();
}

/** The calendar profiles this viewer is allowed to look up. */
export function acceptedScheduleContacts(viewerId: string, ids: string[]) {
  if (!ids.length) return [];
  return getDb().select({
    id: users.id, name: users.name, groupId: users.groupId, facultyId: users.facultyId,
    specializationId: users.specializationId, year: users.year,
  }).from(contacts).innerJoin(users, otherUser(viewerId))
    .where(and(involving(viewerId), eq(contacts.accepted, true), inArray(users.id, ids))).all();
}

export function incomingContactCount(userId: string) {
  return getDb().select({ n: count() }).from(contacts)
    .where(and(involving(userId), eq(contacts.accepted, false), ne(contacts.requestedBy, userId))).get()!.n;
}

export function inviteContact(userId: string, email: string) {
  const { person: recipient, error } = lookupContact(email);
  if (error) throw new InvitationError(error);
  inviteContactById(userId, recipient.id);
}

export function inviteContactById(userId: string, recipientId: string) {
  if (recipientId === userId) throw new InvitationError("notYourself");
  if (typeof recipientId !== "string") throw new InvitationError("accountGone");
  getDb().transaction((tx) => {
    if (!tx.select({ id: users.id }).from(users).where(eq(users.id, recipientId)).get()) {
      throw new InvitationError("accountGone");
    }
    tx.insert(contacts).values({ ...pair(userId, recipientId), requestedBy: userId })
      .onConflictDoNothing().run();
  }, { behavior: "immediate" });
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
