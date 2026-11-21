import type { GoogleEvent } from "../../src/lib/calendar-types";

/** A stateful Calendar API test double with paged change lists, ETags, tombstones and insert IDs. */
export class GoogleCalendarFixture {
  readonly calendarId = "poli-test-calendar";
  events = new Map<string, GoogleEvent & { revision: number }>();
  writes: string[] = [];
  version = 0;
  pageSize = 100;
  minCursor = 0;
  failPage = false;
  loseInsertResponse = false;
  losePatchResponse = false;
  beforePatch?: (id: string) => void;
  invalidGrant = false;
  calendarName = "Poli";

  put(event: GoogleEvent) {
    const saved = { status: "confirmed", ...event, etag: '"' + (++this.version) + '"', revision: this.version };
    this.events.set(event.id, saved);
    return saved;
  }
  remove(id: string) {
    const old = this.events.get(id);
    return this.put({ id, status: "cancelled", recurringEventId: old?.recurringEventId, originalStartTime: old?.originalStartTime });
  }
  live() { return [...this.events.values()].filter(e => e.status !== "cancelled"); }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? String(init.body) : "";
    const error = (status: number) => Response.json({ error: { message: "fixture " + status } }, { status });
    if (url.hostname === "oauth2.googleapis.com") return this.invalidGrant
      ? Response.json({ error: "invalid_grant" }, { status: 400 }) : Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh" });
    if (url.origin !== "https://www.googleapis.com" || new Headers(init?.headers).get("authorization") !== "Bearer fixture-access") return error(403);
    const root = "/calendar/v3/calendars";
    const base = root + "/" + this.calendarId;
    if (url.pathname === root && method === "POST") return Response.json({ id: this.calendarId });
    if (url.pathname === base) {
      if (method === "PATCH") this.calendarName = JSON.parse(body).summary;
      return Response.json({ id: this.calendarId, summary: this.calendarName });
    }
    if (url.pathname === base + "/events" && method === "GET") {
      const cursor = Number(url.searchParams.get("syncToken") ?? 0);
      if (url.searchParams.has("syncToken") && cursor < this.minCursor) return error(410);
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      if (this.failPage && offset) return error(503);
      const items = [...this.events.values()].filter(e => e.revision > cursor).sort((a, b) => a.revision - b.revision);
      return Response.json({ items: items.slice(offset, offset + this.pageSize),
        ...(offset + this.pageSize < items.length ? { nextPageToken: String(offset + this.pageSize) } : { nextSyncToken: String(this.version) }) });
    }
    if (url.pathname === base + "/events" && method === "POST") {
      const event = JSON.parse(body);
      if (this.events.has(event.id)) return error(409);
      const saved = this.put(event);
      this.writes.push(method);
      if (this.loseInsertResponse) { this.loseInsertResponse = false; throw new Error("Connection closed after Google accepted the insert"); }
      return Response.json(saved);
    }
    if (!url.pathname.startsWith(base + "/events/")) return error(404);
    const id = decodeURIComponent(url.pathname.slice((base + "/events/").length));
    if (method === "PATCH" && this.beforePatch) { const cb = this.beforePatch; this.beforePatch = undefined; cb(id); }
    const prior = this.events.get(id);
    if (!prior) return error(404);
    if (method === "GET") return Response.json(prior);
    const etag = new Headers(init?.headers).get("if-match");
    if (!etag || (etag !== "*" && etag !== prior.etag)) return error(412);
    this.writes.push(method);
    if (method === "PATCH") {
      const saved = this.put({ ...prior, ...JSON.parse(body) });
      if (this.losePatchResponse) { this.losePatchResponse = false; throw new Error("Lost PATCH response"); }
      return Response.json(saved);
    }
    if (method === "DELETE") { this.remove(id); return new Response(null, { status: 204 }); }
    return error(405);
  };
}
