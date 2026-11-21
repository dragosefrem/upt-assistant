import "server-only";
import { request as httpRequest } from "node:http";
import type { Locale } from "@/i18n/config";
import { appVideo, isVideoKey, pickByHint, type MediaKind } from "./links";
import { campuspathBase, campuspathLost, CampuspathUnavailable } from "./service";
import type { CampusPlace, Checkpoint, ClassroomPage, Coverage, PlanOutcome, PlanRequest, Question, Route, VideoState } from "./types";

/**
 * Typed calls to every Campuspath endpoint. Media and video URLs in the answers point at this
 * app's proxy (/api/campus/media/…), never at the service. Free of React and Next request APIs.
 */

/** The service answered with an error the caller should not pass on as it is (its texts are English). */
export class CampuspathError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CampuspathError";
  }
}

const TIMEOUT_MS = 30_000;

function unreachable(error: unknown): boolean {
  // fetch reports a refused or reset connection as a TypeError with the system error as cause.
  return error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
}

/** fetch against the service, starting it when needed and once more if it went away. */
export async function campuspathFetch(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const base = await campuspathBase();
    try {
      return await fetch(base + path, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    } catch (error) {
      if (!unreachable(error)) throw error;
      campuspathLost();
      if (attempt >= 1) throw new CampuspathUnavailable("unreachable", (error as Error).message);
    }
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await campuspathFetch(path, init);
  const body = (await response.json().catch(() => null)) as T | { message?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body ? String(body.message) : response.statusText;
    throw new CampuspathError(response.status, message);
  }
  return body as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false || value === "") continue;
    search.set(key, value === true ? "1" : String(value));
  }
  return search.toString();
}

function withAppMedia(route: Route): Route {
  return { ...route, video: appVideo(route.video ?? null) };
}

/** Maps the service's answer to POST /api/routes: a route (200) or a question (422). */
export function planOutcome(status: number, body: unknown): PlanOutcome {
  if (status === 422 && body && typeof body === "object" && "field" in body) {
    const q = body as Partial<Question>;
    return {
      kind: "question",
      question: {
        field: q.field === "start" ? "start" : "destination",
        message: String(q.message ?? ""),
        options: Array.isArray(q.options) ? q.options : [],
        needsChoice: Boolean(q.needsChoice),
      },
    };
  }
  if (status === 200 && body && typeof body === "object" && Array.isArray((body as Route).steps)) {
    return { kind: "route", route: withAppMedia(body as Route) };
  }
  const message = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "";
  throw new CampuspathError(status, message || `Unexpected answer (${status}).`);
}

/**
 * Plans a route. With `hint` (the building a timetable names), a code that exists in several
 * buildings is settled without asking when exactly one of them matches.
 */
export async function planRoute(input: PlanRequest & { hint?: string }): Promise<PlanOutcome> {
  const { hint, ...request } = input;
  const send = async (body: PlanRequest) => {
    const response = await campuspathFetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return planOutcome(response.status, await response.json().catch(() => null));
  };
  const outcome = await send(request);
  if (outcome.kind === "question" && outcome.question.field === "destination" && request.destination === undefined) {
    const pick = pickByHint(outcome.question.options, hint);
    if (pick) return send({ ...request, destination: pick.index });
  }
  return outcome;
}

/** The render state of a walkthrough, or null when the service does not know the key. */
export async function videoStatus(key: string): Promise<VideoState | null> {
  if (!isVideoKey(key)) return null;
  try {
    return appVideo(await json<VideoState>(`/api/videos/${key}`));
  } catch (error) {
    if (error instanceof CampuspathError && error.status === 404) return null;
    throw error;
  }
}

export async function listClassrooms(input: {
  q?: string;
  coverage?: Coverage;
  offset?: number;
  limit?: number;
  lang: Locale;
}): Promise<ClassroomPage> {
  return json<ClassroomPage>(
    `/api/classrooms?${query({ q: input.q?.slice(0, 200), coverage: input.coverage, offset: input.offset, limit: input.limit, lang: input.lang })}`,
  );
}

/** Starting points by name, number (#389) or tour link; with `rooms`, classrooms too. */
export async function searchCheckpoints(input: { q: string; rooms?: boolean; lang: Locale }): Promise<CampusPlace[]> {
  return json<CampusPlace[]>(`/api/checkpoints?${query({ q: input.q.slice(0, 1000), rooms: input.rooms, lang: input.lang })}`);
}

/** The 24 campus buildings with a map pin, for "Locate me". */
export async function buildingPins(lang: Locale): Promise<Checkpoint[]> {
  return json<Checkpoint[]>(`/api/checkpoints?${query({ pins: true, lang })}`);
}

/** The bundled walkthrough from the AC entrance to B419, ready without network. */
export async function exampleRoute(lang: Locale): Promise<Route> {
  return withAppMedia(await json<Route>(`/api/example?${query({ lang })}`));
}

/**
 * A route address as a QR code. The service accepts only addresses on the host it is asked
 * on, so the app's public host goes in the Host header, which fetch does not let us set.
 */
export async function qrCode(input: { link: string; format: "svg" | "png"; host: string }): Promise<{ status: number; type: string; body: Buffer }> {
  const send = async () => {
    const base = new URL(await campuspathBase());
    return new Promise<{ status: number; type: string; body: Buffer }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: base.hostname,
          port: base.port || 80,
          path: `${base.pathname.replace(/\/$/, "")}/api/qr?${query({ link: input.link, format: input.format })}`,
          headers: { Host: input.host },
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 502, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  };
  try {
    return await send();
  } catch (error) {
    campuspathLost();
    try {
      return await send();
    } catch {
      throw new CampuspathUnavailable("unreachable", (error as Error).message);
    }
  }
}

/** Request headers passed on to the service for a media file, so seeking and caching work. */
export const MEDIA_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"] as const;
/** Response headers passed back. */
export const MEDIA_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

/** A walkthrough video or its cover from the service, streamed, with Range requests passed on. */
export async function mediaFile(key: string, kind: MediaKind, headers: Headers): Promise<Response> {
  if (!isVideoKey(key)) return new Response(null, { status: 404 });
  const forward = new Headers();
  for (const name of MEDIA_REQUEST_HEADERS) {
    const value = headers.get(name);
    if (value) forward.set(name, value);
  }
  // Media can be long: no overall timeout while the body streams.
  const response = await campuspathFetch(`/media/${key}.${kind}`, { headers: forward, signal: undefined });
  const out = new Headers();
  for (const name of MEDIA_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  // Only signed-in students reach the proxy, so shared caches must not keep the file.
  out.set("Cache-Control", "private, max-age=86400");
  return new Response(response.body, { status: response.status, headers: out });
}
