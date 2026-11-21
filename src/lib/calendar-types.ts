export type GoogleSyncMode = "one_way" | "two_way";

export function isGoogleSyncMode(value: unknown): value is GoogleSyncMode {
  return value === "one_way" || value === "two_way";
}

/** Event fields shared by the local calendar and Google's Events API. */
export interface CalendarTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarTiming {
  start: CalendarTime;
  end: CalendarTime;
  recurrence?: string[];
  endTimeUnspecified?: boolean;
}

export interface CalendarFields {
  summary: string;
  location: string;
  description: string;
  timing: CalendarTiming;
  reminders: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
}

export interface GoogleEvent extends Partial<Omit<CalendarFields, "timing">>, Partial<CalendarTiming> {
  id: string;
  etag?: string;
  status?: string;
  recurringEventId?: string;
  originalStartTime?: CalendarTime;
  extendedProperties?: { private?: Record<string, string> };
}
