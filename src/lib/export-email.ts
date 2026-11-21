import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { settings } from "@/i18n/messages/settings";
import { isEmail, normalizeEmail, type User } from "./auth";
import { exportItems, toICS } from "./export";
import { mailConfigured, sendMail } from "./mail";
import { currentSemester } from "./schedule";

/**
 * "Email my calendar": sends the student's timetable as an .ics attachment that any
 * calendar app can import, without connecting a Google account.
 */

/** Shortest time between two calendar e-mails from one account. */
export const EMAIL_INTERVAL_MS = 60_000;

export { isEmail };

/** The app's address if calendar services could reach it; a localhost URL is no use in an e-mail. */
export function publicBaseUrl(appUrl = process.env.APP_URL): string | null {
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/.test(url.hostname)) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** Subject, body and attachment of the calendar e-mail, in `locale` (default English). */
export function calendarEmail(opts: { ics: string; semester: string | null; feedUrl: string | null; locale?: Locale }) {
  const t = settings[opts.locale ?? "en"].mail;
  const lines = [t.greeting, "", t.attached(opts.semester), "", t.howTo, t.google, t.apple, t.outlook, "", t.snapshot];
  if (opts.feedUrl) lines.push("", t.subscribe, opts.feedUrl);
  lines.push("", t.signature);
  return {
    subject: t.subject,
    text: lines.join("\n"),
    attachments: [{ filename: "upt-orar.ics", content: opts.ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
  };
}

export type EmailCalendarResult = { ok: true; sentTo: string } | { ok: false; status: number; error: string };

/**
 * E-mails the student's calendar to `to`, or to the address they used last time, or
 * to their sign-in address. Settings remembers a successful recipient. One-time shares
 * can keep the existing preference, and a new recipient only receives the attachment.
 *
 * `locale` is the language of the e-mail, the calendar inside it and the error messages:
 * the account's language when it has one, else English. Callers serving a request pass
 * `user.locale ?? <request language>`.
 */
export async function emailCalendar(
  user: User,
  to?: string,
  transport?: Transporter,
  locale: Locale = user.locale ?? "en",
  { rememberAddress = true }: { rememberAddress?: boolean } = {},
): Promise<EmailCalendarResult> {
  const t = settings[locale].export.errors;
  if (!transport && !mailConfigured()) {
    return { ok: false, status: 503, error: t.mailNotConfigured };
  }
  const address = (to ?? user.exportEmail ?? user.email).trim();
  if (!isEmail(address)) return { ok: false, status: 400, error: t.badAddress };
  const items = exportItems(user, locale);
  if (!items.length) return { ok: false, status: 409, error: t.emptyCalendar };

  // Claim the send slot atomically, so a double click or a retry cannot send twice.
  const db = getDb();
  const now = new Date();
  const claimedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - EMAIL_INTERVAL_MS).toISOString();
  const previous = db.select({ at: users.calendarEmailedAt }).from(users).where(eq(users.id, user.id)).get()?.at ?? null;
  const claimed = db
    .update(users)
    .set({ calendarEmailedAt: claimedAt })
    .where(and(eq(users.id, user.id), or(isNull(users.calendarEmailedAt), lt(users.calendarEmailedAt, cutoff))))
    .run();
  if (claimed.changes === 0) {
    const wait = previous ? Math.max(1, Math.ceil((Date.parse(previous) + EMAIL_INTERVAL_MS - now.getTime()) / 1000)) : 60;
    return { ok: false, status: 429, error: t.wait(wait) };
  }

  const semester = currentSemester();
  const knownRecipient = [user.email, user.exportEmail].some((saved) => saved && normalizeEmail(saved) === normalizeEmail(address));
  const base = knownRecipient ? publicBaseUrl() : null;
  const message = calendarEmail({
    ics: toICS(items),
    semester: semester ? common[locale].time.semester(semester.number, semester.academicYear) : null,
    feedUrl: base ? `${base}/api/ics/${user.feedToken}.ics` : null,
    locale,
  });
  try {
    await sendMail({ to: address, ...message }, transport);
  } catch (err) {
    // Give the slot back, so the student can retry once the problem is fixed.
    db.update(users).set({ calendarEmailedAt: previous }).where(and(eq(users.id, user.id), eq(users.calendarEmailedAt, claimedAt))).run();
    console.error("Calendar email failed", err);
    return { ok: false, status: 502, error: t.sendFailed };
  }
  if (rememberAddress) {
    db.update(users).set({ exportEmail: address }).where(and(eq(users.id, user.id), eq(users.calendarEmailedAt, claimedAt))).run();
  }
  return { ok: true, sentTo: address };
}
