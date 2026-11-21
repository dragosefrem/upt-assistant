import "server-only";
import type { Locale } from "@/i18n/config";
import type { User } from "../auth";
import type { LatLng } from "../directions";
import type { CalEvent } from "../schedule";
import { DAY_NAMES, formatMinutes, weekday } from "../time";
import type { AssistantChoice, AssistantLink, StoredPreview } from "./choices";

/** Types and small parsers shared by every group of assistant tools. */

export interface ToolContext {
  user: User;
  /** Browser geolocation, when the student has shared it. */
  location: LatLng | null;
  /** Set by a handler that changed the student's data, so the UI can refresh. */
  changed: boolean;
  /** Interface language: for texts a tool writes into the calendar and for the pages it links to. */
  locale?: Locale;
  /** Tappable choices to show under the reply (set by show_choices). */
  choices?: AssistantChoice[];
  /** A proposed calendar change to preview for the student (set by add/move without `confirmed`). */
  preview?: StoredPreview;
  /** Buttons under the reply that open a page of the app. */
  links?: AssistantLink[];
  /** Set by open_page: the browser goes to this in-app address once the reply is shown. */
  open?: string;
  /** Set by set_language: the browser switches the interface to this language. */
  setLocale?: Locale;
}

export interface AssistantTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Returns the result, or a promise of it for tools that do I/O (such as sending e-mail). */
  run(input: Record<string, unknown>, ctx: ToolContext): unknown;
}

export const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** A list of non-empty strings; a single string counts as a list of one. */
export function strList(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  return Array.isArray(v) ? v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : [])) : [];
}

export function parseClock(v: unknown): number | undefined {
  const m = typeof v === "string" ? /^(\d{1,2})(?::(\d{2}))?$/.exec(v.trim()) : null;
  if (!m) return undefined;
  const minutes = +m[1] * 60 + +(m[2] ?? 0);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : undefined;
}

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** A date as the model should read it back: "Wednesday 2026-11-25". */
export const dated = (date: string) => `${DAY_NAMES[weekday(date)]} ${date}`;
export const span = (startMin: number, endMin: number) => `${formatMinutes(startMin)}–${formatMinutes(endMin)}`;

/** What the model is told about one calendar event. */
export function brief(e: CalEvent) {
  return {
    type: e.type,
    kind: e.kind,
    title: e.title,
    date: e.date,
    weekday: DAY_NAMES[weekday(e.date)],
    start: formatMinutes(e.startMin),
    end: e.endMin === e.startMin ? null : formatMinutes(e.endMin),
    room: e.room,
    building: e.place?.name ?? null,
    address: e.place?.address ?? null,
    teacher: e.teacher,
    note: e.note,
    // Lets the assistant name exactly which of the student's own events to move or delete.
    ...(e.personalId != null ? { personal_event_id: e.personalId } : {}),
    ...(e.attendance ? { attendance: e.attendance } : {}),
  };
}

/** Adds a button under the reply that opens an in-app page. */
export function addLink(ctx: ToolContext, label: string, href: string) {
  ctx.links = [...(ctx.links ?? []).filter((l) => l.href !== href), { label, href }].slice(-3);
}
