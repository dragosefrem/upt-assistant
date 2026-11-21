import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Transporter } from "nodemailer";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { User } from "./auth";
import { exportItems, toICS } from "./export";
import { mailConfigured, sendMail } from "./mail";
import { currentSemester } from "./schedule";

/**
 * "Email my calendar": sends the student's timetable as an .ics attachment that any
 * calendar app can import, without connecting a Google account.
 */

/** Shortest time between two calendar e-mails from one account. */
export const EMAIL_INTERVAL_MS = 60_000;

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

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

/** Subject, body and attachment of the calendar e-mail. */
export function calendarEmail(opts: { ics: string; semester: string | null; feedUrl: string | null }) {
  const lines = [
    "Hi,",
    "",
    `Your UPT timetable is attached as upt-orar.ics: your classes, exams and own events${opts.semester ? ` for ${opts.semester}` : ""}.`,
    "",
    "To add it to your calendar:",
    "- Google Calendar, on a computer: Settings > Import & export > Import, choose upt-orar.ics and the calendar to add it to. Tip: create a calendar called \"UPT Orar\" first, so you can remove it all in one go later.",
    "- iPhone, iPad or Mac: open the attachment and choose Add All.",
    "- Outlook: open the attachment and add it to your calendar.",
    "",
    "The file is a snapshot of your calendar today. After you change your group, courses or events, send it again from Settings > Export your calendar.",
  ];
  if (opts.feedUrl) {
    lines.push(
      "",
      "To stay in sync automatically instead, subscribe to this link (in Google Calendar: Other calendars > + > From URL). Anyone with the link can see your timetable, so keep it to yourself:",
      opts.feedUrl,
    );
  }
  lines.push("", "UPT Orar");
  return {
    subject: "Your UPT timetable",
    text: lines.join("\n"),
    attachments: [{ filename: "upt-orar.ics", content: opts.ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
  };
}

export type EmailCalendarResult = { ok: true; sentTo: string } | { ok: false; status: number; error: string };

/**
 * E-mails the student's calendar to `to`, or to the address they used last time, or
 * to their sign-in address. A successful send remembers the address.
 */
export async function emailCalendar(user: User, to?: string, transport?: Transporter): Promise<EmailCalendarResult> {
  if (!transport && !mailConfigured()) {
    return { ok: false, status: 503, error: "Email isn't set up on this server yet, so download the .ics file instead." };
  }
  const address = (to ?? user.exportEmail ?? user.email).trim();
  if (!isEmail(address)) return { ok: false, status: 400, error: "That doesn't look like an email address." };
  const items = exportItems(user);
  if (!items.length) return { ok: false, status: 409, error: "Your calendar is empty. Choose your group or add an event first." };

  // Claim the send slot atomically, so a double click or a retry cannot send twice.
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - EMAIL_INTERVAL_MS).toISOString();
  const previous = db.select({ at: users.calendarEmailedAt }).from(users).where(eq(users.id, user.id)).get()?.at ?? null;
  const claimed = db
    .update(users)
    .set({ calendarEmailedAt: now.toISOString() })
    .where(and(eq(users.id, user.id), or(isNull(users.calendarEmailedAt), lt(users.calendarEmailedAt, cutoff))))
    .run();
  if (claimed.changes === 0) {
    const wait = previous ? Math.max(1, Math.ceil((Date.parse(previous) + EMAIL_INTERVAL_MS - now.getTime()) / 1000)) : 60;
    return { ok: false, status: 429, error: `Your calendar was just sent. Please wait ${wait} seconds before sending it again.` };
  }

  const semester = currentSemester();
  const base = publicBaseUrl();
  const message = calendarEmail({
    ics: toICS(items),
    semester: semester ? `semester ${semester.number}, ${semester.academicYear}` : null,
    feedUrl: base ? `${base}/api/ics/${user.feedToken}.ics` : null,
  });
  try {
    await sendMail({ to: address, ...message }, transport);
  } catch (err) {
    // Give the slot back, so the student can retry once the problem is fixed.
    db.update(users).set({ calendarEmailedAt: previous }).where(eq(users.id, user.id)).run();
    console.error("Calendar email failed", err);
    return { ok: false, status: 502, error: "The email could not be sent. Please try again later." };
  }
  db.update(users).set({ exportEmail: address }).where(eq(users.id, user.id)).run();
  return { ok: true, sentTo: address };
}
