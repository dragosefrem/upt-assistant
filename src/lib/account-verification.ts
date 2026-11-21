import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, type DB } from "@/db";
import { registrationLinks, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { auth } from "@/i18n/messages/auth";
import { createUser, normalizeEmail } from "./auth";
import { accountMailConfigured, sendAccountMail } from "./mail";

const HOUR = 60 * 60_000;
const emailAddress = z.email().max(254);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function requestRegistrationLink(input: {
  email: string; baseUrl: string | null; invite: string | null; locale: Locale; client: string;
}) {
  const email = normalizeEmail(input.email);
  if (!emailAddress.safeParse(email).success) return "badEmail";
  const db = getDb();
  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) return "exists";
  if (!input.baseUrl || !accountMailConfigured()) return "verificationUnavailable";

  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  const id = digest(token);
  const clientKey = digest(input.client);
  const issued = db.transaction((tx) => {
    tx.delete(registrationLinks).where(lte(registrationLinks.createdAt, now - HOUR)).run();
    const recent = tx.select({ at: registrationLinks.createdAt }).from(registrationLinks)
      .where(eq(registrationLinks.email, email)).orderBy(desc(registrationLinks.createdAt)).limit(3).all();
    if (recent.length >= 3 || (recent[0] && recent[0].at > now - 60_000)) return false;
    const clientSends = tx.select({ n: count() }).from(registrationLinks)
      .where(and(eq(registrationLinks.clientKey, clientKey), gt(registrationLinks.createdAt, now - 15 * 60_000))).get()!;
    if (clientSends.n >= 30) return false;
    tx.insert(registrationLinks).values({ id, email, invite: input.invite, clientKey, createdAt: now }).run();
    return true;
  }, { behavior: "immediate" });
  if (!issued) return "verificationLimited";

  const t = auth[input.locale].verification.mail;
  const link = `${input.baseUrl}/verify/${token}`;
  try {
    await sendAccountMail({ to: email, subject: t.subject, text: [t.intro, link, t.expires, t.ignore, "Poli"].join("\n\n") }, `registration/${id}`);
  } catch (error) {
    db.delete(registrationLinks).where(eq(registrationLinks.id, id)).run();
    console.error("Registration e-mail delivery failed", error instanceof Error ? error.name : "transport error");
    return "verificationSendFailed";
  }
  return "sent";
}

export function registrationTarget(token: string, db: Pick<DB, "select"> = getDb()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.select({ email: registrationLinks.email, invite: registrationLinks.invite }).from(registrationLinks)
    .where(and(eq(registrationLinks.id, digest(token)), gt(registrationLinks.createdAt, Date.now() - HOUR))).get() ?? null;
}

/** Consuming the proof, creating the account and invalidating sibling links share one commit. */
export function completeRegistration(token: string, details: { name: string; password: string; locale: Locale }) {
  return getDb().transaction((tx) => {
    const target = registrationTarget(token, tx);
    if (!target) return null;
    tx.delete(registrationLinks).where(eq(registrationLinks.email, target.email)).run();
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, target.email)).get()) return null;
    const user = createUser({ ...details, email: target.email, emailVerifiedAt: new Date().toISOString() }, tx);
    return { user, invite: target.invite };
  }, { behavior: "immediate" });
}
