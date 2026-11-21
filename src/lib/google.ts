import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { User } from "./auth";
import { exportItems, localStamp, type ExportItem } from "./export";
import { TIME_ZONE, addDays, formatMinutes } from "./time";

/**
 * Google Calendar export over plain REST.
 *
 * The app asks only for `calendar.app.created`: it can create its own "UPT Orar"
 * calendar and manage events inside it, and cannot read or touch anything else in the
 * student's Google account.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_NAME = "UPT Orar";

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function appUrl(request?: Request): string {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return request ? new URL(request.url).origin : "http://localhost:3000";
}

const redirectUri = (request?: Request) => `${appUrl(request)}/api/google/callback`;

export function consentUrl(state: string, request?: Request): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // Forces a refresh token even if the student connected before.
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error_description ?? data.error ?? "Google rejected the request.", res.status);
  return data;
}

export async function exchangeCode(code: string, request?: Request): Promise<string> {
  const data = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri(request) });
  if (!data.refresh_token) throw new GoogleError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  return data.refresh_token;
}

async function call<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error?.message ?? `Google Calendar returned ${res.status}.`, res.status);
  return data as T;
}

function toGoogleEvent(item: ExportItem) {
  const recurrence: string[] = [];
  if (item.until) {
    recurrence.push(`RRULE:FREQ=WEEKLY;UNTIL=${item.until.replace(/-/g, "")}T235959Z`);
    if (item.exdates?.length) {
      recurrence.push(`EXDATE;TZID=${TIME_ZONE}:${item.exdates.map((d) => localStamp(d, item.startMin)).join(",")}`);
    }
  }
  const at = (minutes: number) => ({
    dateTime: `${minutes === 1440 ? addDays(item.date, 1) : item.date}T${formatMinutes(minutes % 1440)}:00`,
    timeZone: TIME_ZONE,
  });
  return {
    summary: item.title,
    description: item.description || undefined,
    location: item.location || undefined,
    start: at(item.startMin),
    end: at(item.endMin),
    recurrence: recurrence.length ? recurrence : undefined,
    // Marks events this app owns, so a re-sync replaces exactly those.
    extendedProperties: { private: { uptOrar: item.uid } },
    reminders: { useDefault: true },
  };
}

/**
 * Replaces the contents of the student's "UPT Orar" Google calendar with their current
 * timetable. Returns how many events were written.
 */
export async function syncToGoogle(user: User): Promise<{ events: number; calendarId: string }> {
  if (!user.googleRefreshToken) throw new GoogleError("Google Calendar is not connected.");
  const db = getDb();
  let accessToken: string;
  try {
    accessToken = (await token({ grant_type: "refresh_token", refresh_token: user.googleRefreshToken })).access_token;
  } catch (err) {
    if (err instanceof GoogleError && err.status === 400) {
      // The student revoked access (or the token expired): require a fresh connect.
      db.update(users).set({ googleRefreshToken: null, googleCalendarId: null }).where(eq(users.id, user.id)).run();
      throw new GoogleError("Google access was revoked. Connect Google Calendar again.");
    }
    throw err;
  }

  let calendarId = user.googleCalendarId;
  if (calendarId) {
    try {
      await call(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
    } catch (err) {
      if (err instanceof GoogleError && (err.status === 404 || err.status === 410)) calendarId = null;
      else throw err;
    }
  }
  if (!calendarId) {
    const created = await call<{ id: string }>(accessToken, "POST", "/calendars", { summary: CALENDAR_NAME, timeZone: TIME_ZONE });
    calendarId = created.id;
    db.update(users).set({ googleCalendarId: calendarId }).where(eq(users.id, user.id)).run();
  }
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;

  // Remove what a previous sync wrote, then write the current timetable.
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: "250", showDeleted: "false" });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await call<{ items?: Array<{ id: string; extendedProperties?: { private?: Record<string, string> } }>; nextPageToken?: string }>(
      accessToken,
      "GET",
      `${base}?${q}`,
    );
    for (const event of page.items ?? []) {
      if (event.extendedProperties?.private?.uptOrar) await call(accessToken, "DELETE", `${base}/${encodeURIComponent(event.id)}`);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const items = exportItems(user);
  for (const item of items) await call(accessToken, "POST", base, toGoogleEvent(item));

  db.update(users).set({ googleSyncedAt: new Date().toISOString() }).where(eq(users.id, user.id)).run();
  return { events: items.length, calendarId };
}
