/**
 * A tappable option the assistant shows under a reply: a proposed time slot or a quick
 * answer such as "Yes, add it". Shared by the server and the chat UI, so it must not
 * import anything server-only.
 */
export interface AssistantChoice {
  /** Button text. */
  label: string;
  /** Sent as the student's next message when the choice is tapped. */
  reply: string;
  /** Set when the choice is a time slot: YYYY-MM-DD, HH:MM, HH:MM. */
  date?: string;
  start?: string;
  end?: string;
}

/** One event on the day shown in a change preview. */
export interface PreviewEvent {
  title: string;
  kind: string;
  start: string;
  end: string;
  room: string | null;
  /** Whether the proposed time overlaps this event. */
  overlaps: boolean;
}

/**
 * A proposed change to the student's calendar, shown as that day's timeline with the
 * change highlighted. Nothing is saved until the student accepts it.
 */
export interface DayPreview {
  status: "pending" | "accepted";
  action: "add" | "move";
  title: string;
  /** The day shown, YYYY-MM-DD; for a weekly event, its next occurrence. */
  date: string;
  weekly: boolean;
  start: string;
  end: string;
  /** Where a moved event is now. */
  from?: { date: string; start: string; end: string };
  /** Everything else on that day. */
  events: PreviewEvent[];
}

/** The stored form also records the exact change to apply on acceptance; it never leaves the server. */
export interface StoredPreview extends DayPreview {
  change: { tool: "add_personal_event" | "move_personal_event" | "move_class_once"; args: Record<string, unknown> };
}

export function parsePreview(json: string | null | undefined): StoredPreview | undefined {
  if (!json) return undefined;
  try {
    const p = JSON.parse(json) as StoredPreview;
    return p && typeof p === "object" && typeof p.date === "string" && Array.isArray(p.events) ? p : undefined;
  } catch {
    return undefined;
  }
}

/** What the browser may see of a preview. */
export function publicPreview(p: StoredPreview | undefined): DayPreview | undefined {
  if (!p) return undefined;
  const { change: _change, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

/** Reads choices stored with a chat message; anything malformed yields none. */
export function parseChoices(json: string | null | undefined): AssistantChoice[] | undefined {
  if (!json) return undefined;
  try {
    const list = JSON.parse(json) as unknown;
    if (!Array.isArray(list)) return undefined;
    const valid = list.filter(
      (c): c is AssistantChoice => !!c && typeof c === "object" && typeof c.label === "string" && typeof c.reply === "string",
    );
    return valid.length ? valid : undefined;
  } catch {
    return undefined;
  }
}
