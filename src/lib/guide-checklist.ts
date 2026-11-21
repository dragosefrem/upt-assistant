import { guide } from "@/i18n/messages/guide";

const key = "upt-first-week";
const changed = "upt:first-week-changed";
const ids = new Set(guide.en.steps.map(step => step.id));

export type ChecklistEdit = { step: string; done: boolean };
export function checklistIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && ids.has(id)))] : [];
}

let temporary: string[] = [];
export function readChecklist(): string[] {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? temporary : checklistIds(JSON.parse(stored));
  } catch {
    return temporary;
  }
}

export function updateChecklist({ step, done }: ChecklistEdit) {
  if (!ids.has(step) || typeof done !== "boolean") return;
  const next = new Set(readChecklist());
  if (done) next.add(step);
  else next.delete(step);
  temporary = [...next];
  try {
    localStorage.setItem(key, JSON.stringify(temporary));
  } catch { /* Keep the ticks for this visit when device storage is unavailable. */ }
  window.dispatchEvent(new Event(changed));
}

export function watchChecklist(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      temporary = [];
      listener();
    }
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", onStorage);
  };
}
