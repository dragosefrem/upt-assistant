"use client";

import type { Place } from "@/lib/schedule";
import type { CampusPlace, Checkpoint, ClassroomPage, Coverage, Question, Route, VideoState } from "@/lib/campuspath/types";

/** Calls to /api/campus/… from the campus page. Errors carry the server's translated message. */
export class CampusApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The walkthrough service is down (503). */
    readonly unavailable = false,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // No answer at all: the page says to check the connection.
    throw new CampusApiError("", 0);
  }
  const body = await response.json().catch(() => null);
  if (response.ok) return body as T;
  throw new CampusApiError(body?.error ?? body?.message ?? "", response.status, response.status === 503 || !!body?.unavailable);
}

export interface PlanBody {
  prompt: string;
  from?: string;
  start?: number | string;
  destination?: number | string;
  /** The building a timetable names for the room. */
  hint?: string;
  /** The student's faculty, for a timetable room whose building is not named. */
  faculty?: string;
}

const get = { cache: "no-store" } as const;

export const campusApi = {
  plan: (body: PlanBody) => call<({ route: Route } | { question: Question }) & { building?: Place | null }>("/api/campus/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
  example: () => call<Route>("/api/campus/example", get),
  video: (key: string) => call<VideoState>(`/api/campus/videos/${encodeURIComponent(key)}`, get),
  checkpoints: (q: string) => call<CampusPlace[]>(`/api/campus/checkpoints?${new URLSearchParams({ q, rooms: "1" })}`, get),
  checkpoint: async (index: number) => (await call<CampusPlace[]>(`/api/campus/checkpoints?${new URLSearchParams({ q: `#${index}` })}`, get))[0] ?? null,
  pins: () => call<Checkpoint[]>("/api/campus/checkpoints?pins=1"),
  classrooms: (q: string, coverage: Coverage | "", offset: number, limit: number) =>
    call<ClassroomPage>(
      `/api/campus/classrooms?${new URLSearchParams({ q, offset: String(offset), limit: String(limit), ...(coverage ? { coverage } : {}) })}`,
      get,
    ),
};

export const qrUrl = (link: string, format: "svg" | "png") => `/api/campus/qr?${new URLSearchParams({ link, format })}`;
