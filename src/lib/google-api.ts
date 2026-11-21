import "server-only";
// This OAuth grant is limited to calendars created by this app.
const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const API = "https://www.googleapis.com/calendar/v3";


/**
 * A failure talking to Google. `known` messages are written by this app in the student's
 * language; the others are Google's own (English) explanations.
 */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly known = false,
    readonly reason?: string,
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

export async function token(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error_description ?? data.error ?? "Google rejected the request.", res.status, false, data.error);
  return data;
}

export async function exchangeCode(code: string, request?: Request): Promise<string> {
  const data = await token({ code, grant_type: "authorization_code", redirect_uri: redirectUri(request) });
  if (!data.refresh_token) throw new GoogleError("Google did not return a refresh token. Remove the app's access in your Google account and connect again.");
  return data.refresh_token;
}

export async function call<T>(accessToken: string, method: string, path: string, body?: unknown, etag?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, ...(etag ? { "If-Match": etag } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error?.message ?? `Google Calendar returned ${res.status}.`, res.status);
  return data as T;
}
