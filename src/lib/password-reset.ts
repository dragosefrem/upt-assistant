import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { getDb } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { auth } from "@/i18n/messages/auth";
import { hashPassword, normalizeEmail, type User } from "./auth";
import { mailConfigured, sendMail } from "./mail";

/**
 * "Forgot password?": a one-time link sent to the account's e-mail address.
 *
 * Only the SHA-256 of the token is stored, so a copy of the database cannot be used to
 * reset anyone's password. A link works once, for an hour. Asking for a link gives the
 * same answer whether or not the address has an account.
 */

export const RESET_MINUTES = 60;
/** Links one account may be sent per hour. */
export const RESET_LIMIT = 3;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The link's subject and bodies, in `locale`. */
export function resetEmail(user: Pick<User, "name">, link: string, locale: Locale) {
  const t = auth[locale].mail;
  const first = user.name.trim().split(/\s+/)[0] || user.name;
  const text = [t.greeting(first), "", t.line, link, "", t.expires, t.ignore, "", t.signature].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px;background:#f7f8fc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:20px;padding:28px;border:1px solid #e2e8f0">
<p style="margin:0 0 12px;font-size:16px">${escapeHtml(t.greeting(first))}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(t.line)}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f48c4;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escapeHtml(t.button)}</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#475569">${escapeHtml(t.expires)}</p>
<p style="margin:0 0 20px;font-size:13px;color:#475569">${escapeHtml(t.ignore)}</p>
<p style="margin:0;font-size:13px;color:#475569">${escapeHtml(t.signature)}</p>
</div></body></html>`;
  return { subject: t.subject, text, html };
}

export type ResetRequest = "sent" | "too-many" | "not-configured" | "failed";

/**
 * Sends a reset link if `email` belongs to an account. The result never reveals whether
 * it does: an unknown address is reported as "sent" too. `baseUrl` is the app's own
 * address, without a trailing slash; `transport` replaces SMTP in tests.
 */
export async function requestPasswordReset(email: string, baseUrl: string, locale: Locale, transport?: Transporter): Promise<ResetRequest> {
  if (!transport && !mailConfigured()) return "not-configured";
  const db = getDb();
  const user = db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
  if (!user) return "sent";

  const now = Date.now();
  // Expired links are of no further use; what remains was created within the last hour.
  db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), lt(passwordResets.expiresAt, new Date(now).toISOString()))).run();
  const recent = db.select({ id: passwordResets.id }).from(passwordResets).where(eq(passwordResets.userId, user.id)).all();
  if (recent.length >= RESET_LIMIT) return "too-many";

  const token = randomBytes(32).toString("base64url");
  db.insert(passwordResets)
    .values({ id: sha256(token), userId: user.id, expiresAt: new Date(now + RESET_MINUTES * 60_000).toISOString(), createdAt: new Date(now).toISOString() })
    .run();
  const message = resetEmail(user, `${baseUrl}/reset/${token}`, user.locale ?? locale);
  try {
    await sendMail({ to: user.email, ...message }, transport);
  } catch (error) {
    console.error("Password reset: the e-mail could not be sent", error);
    db.delete(passwordResets).where(eq(passwordResets.id, sha256(token))).run();
    return "failed";
  }
  return "sent";
}

/** The account a token can reset right now, or null if the token is unknown, used or expired. */
export function resetTarget(token: string): Pick<User, "id" | "email" | "name"> | null {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = getDb()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date().toISOString())))
    .get();
  return row ?? null;
}

/**
 * Sets a new password with a valid token. The token is spent, every other reset link of
 * the account stops working, and the account is signed out everywhere, so whoever knew
 * the old password is locked out.
 */
export function resetPassword(token: string, password: string): boolean {
  const db = getDb();
  return db.transaction((tx) => {
    const target = resetTarget(token);
    if (!target) return false;
    const now = new Date().toISOString();
    const claimed = tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.id, sha256(token)), isNull(passwordResets.usedAt))).run();
    if (claimed.changes === 0) return false;
    tx.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, target.id)).run();
    tx.delete(passwordResets).where(and(eq(passwordResets.userId, target.id), isNull(passwordResets.usedAt))).run();
    tx.delete(sessions).where(eq(sessions.userId, target.id)).run();
    return true;
  });
}
