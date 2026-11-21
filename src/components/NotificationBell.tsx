"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExamReminder } from "@/lib/reminders";
import { formatDate, formatMinutes } from "@/lib/time";
import { Mascot } from "./Mascot";

/** Minutes before an exam at which Poli reminds the student: a week, a day, 2 hours, 30 minutes. */
const MILESTONES = [7 * 1440, 1440, 120, 30];
const PREF_KEY = "upt-notify";
const FIRED_KEY = "upt-notify-fired";
const SEEN_KEY = "upt-notify-seen";

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, set: Set<string>) {
  try {
    // Keep the list short: old exams drop off.
    localStorage.setItem(key, JSON.stringify([...set].slice(-200)));
  } catch {
    // Storage unavailable (private mode): reminders still show, they may just repeat.
  }
}

/** What the reminder says at a milestone: when, and which room to go to. */
function message(r: ExamReminder, minutesLeft: number): { title: string; body: string } {
  const where = [r.room ? `Room ${r.room}` : null, r.place?.name].filter(Boolean).join(" · ") || "Check the room on the exam list";
  const when = `${formatDate(r.date, { weekday: "long", day: "numeric", month: "short" })}, ${formatMinutes(r.startMin)}`;
  if (minutesLeft <= 30) return { title: `📝 ${r.course} starts in ${Math.max(1, minutesLeft)} min`, body: `Head to ${where}. Good luck! 🍀` };
  if (minutesLeft <= 120) return { title: `📝 ${r.course} in ${Math.round(minutesLeft / 60) || 1} h`, body: `${where}. Time to get going, and bring your student ID.` };
  if (minutesLeft <= 1440) return { title: `📝 ${r.course} exam tomorrow`, body: `${when} · ${where}. Light review and a good night's sleep! 😴` };
  const days = Math.max(2, r.daysLeft);
  return { title: `📝 ${r.course} exam in ${days} days`, body: `${when} · ${where}. ${r.tips[0] ?? ""}` };
}

/**
 * The bell in the header: upcoming exam reminders with the room to go to, and optional
 * device notifications while the app is open. (For alerts when the app is closed, the
 * Google Calendar and .ics exports carry reminders 1 day and 2 hours before each exam.)
 */
export function NotificationBell() {
  const [reminders, setReminders] = useState<ExamReminder[]>([]);
  const [tip, setTip] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { reminders: ExamReminder[]; tip: string };
      setReminders(data.reminders);
      setTip(data.tip);
      setFetchedAt(Date.now());
    } catch {
      // Offline: keep the last list.
    }
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser-only state after hydration */
    setSeen(readSet(SEEN_KEY));
    setMounted(true);
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    try {
      setEnabled(localStorage.getItem(PREF_KEY) === "on");
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
    void load();
    const refresh = setInterval(load, 5 * 60_000);
    return () => clearInterval(refresh);
  }, [load]);

  // Check the milestones every 30 seconds and remind once per exam and milestone.
  useEffect(() => {
    if (!fetchedAt || !reminders.length) return;
    const check = () => {
      const elapsed = Math.floor((Date.now() - fetchedAt) / 60_000);
      const fired = readSet(FIRED_KEY);
      let changed = false;
      let first: { title: string; body: string } | null = null;
      // Reminders come nearest first, so the most urgent one gets the on-screen toast.
      for (const r of reminders) {
        const left = r.minutesUntil - elapsed;
        if (left <= 0) continue;
        // The closest milestone already reached; earlier ones count as done, so opening
        // the app late gives one reminder, not four.
        const reached = MILESTONES.filter((m) => left <= m);
        if (!reached.length) continue;
        const current = Math.min(...reached);
        const key = `${r.id}:${current}`;
        if (fired.has(key)) continue;
        reached.forEach((m) => fired.add(`${r.id}:${m}`));
        changed = true;
        const msg = message(r, left);
        first ??= msg;
        if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const n = new Notification(msg.title, { body: msg.body, tag: key, icon: "/images/mascot.svg" });
            n.onclick = () => {
              window.focus();
              router.push("/exams");
            };
          } catch {
            // Some mobile browsers only allow notifications from a service worker.
          }
        }
      }
      if (first) setToast(first);
      if (changed) writeSet(FIRED_KEY, fired);
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [reminders, fetchedAt, enabled, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The bell counts exams within a week the student has not looked at at this stage yet.
  const relevant = reminders.filter((r) => r.stage !== "later");
  const unseen = relevant.filter((r) => !seen.has(`${r.id}:${r.stage}`));

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) setToast(null);
    if (next && unseen.length) {
      const s = new Set(seen);
      relevant.forEach((r) => s.add(`${r.id}:${r.stage}`));
      setSeen(s);
      writeSet(SEEN_KEY, s);
    }
  };

  const toggleDevice = async () => {
    if (enabled) {
      setEnabled(false);
      try {
        localStorage.setItem(PREF_KEY, "off");
      } catch {}
      return;
    }
    if (typeof Notification === "undefined") return;
    const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setPermission(result);
    if (result === "granted") {
      setEnabled(true);
      try {
        localStorage.setItem(PREF_KEY, "on");
      } catch {}
      new Notification("🔔 Poli will remind you", { body: "A week, a day, 2 hours and 30 minutes before each exam, with the room to go to.", icon: "/images/mascot.svg" });
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        onClick={toggleOpen}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:bg-slate-100 ${unseen.length ? "animate-wiggle" : ""}`}
        aria-label={unseen.length ? `Reminders, ${unseen.length} new` : "Reminders"}
        aria-expanded={open}
        title="Exam reminders"
      >
        <span aria-hidden>🔔</span>
        {unseen.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unseen.length}
          </span>
        )}
      </button>

      {/* Rendered on <body>, so the list and the toast sit above Poli's button and the chat. */}
      {open && mounted && createPortal(
        <div ref={panel} role="dialog" aria-label="Exam reminders" className="animate-pop fixed inset-x-2 top-16 z-[60] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl sm:inset-x-auto sm:right-4 sm:top-14 sm:w-[24rem]">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3">
            <Mascot size={30} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">Reminders</p>
              <p className="text-xs text-slate-500">Your exams in the next 30 days</p>
            </div>
          </div>
          <div className="max-h-[45vh] overflow-y-auto sm:max-h-[60vh]">
            {reminders.length ? (
              <ul className="divide-y divide-slate-100">
                {reminders.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${r.stage === "later" ? "bg-slate-300" : r.stage === "week" || r.stage === "soon" ? "bg-amber-400" : "bg-red-500"}`} />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold text-slate-900">
                          {r.course} <span className="font-medium text-slate-500">· {r.countdown}</span>
                        </p>
                        <p className="text-slate-600">
                          {formatDate(r.date, { weekday: "short", day: "numeric", month: "short" })}, {formatMinutes(r.startMin)} ·{" "}
                          <span className="font-medium text-slate-800">{r.room ? `Room ${r.room}` : "Room TBA"}</span>
                          {r.place ? ` · ${r.place.name}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">💡 {r.tips[0]}</p>
                        {r.mapsUrl && (
                          <a href={r.mapsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
                            Open map ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-slate-600">No exams in the next 30 days 🎉{tip ? <span className="mt-1 block text-xs text-slate-500">💡 {tip}</span> : null}</p>
            )}
          </div>
          <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {permission === "unsupported" ? (
              <p>This browser can&apos;t show notifications.</p>
            ) : permission === "denied" ? (
              <p>Notifications are blocked for this site. Allow them in the browser&apos;s site settings to get reminders.</p>
            ) : (
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span>
                  <span className="block font-medium text-slate-800">Notify me on this device</span>
                  A week, a day, 2 h and 30 min before, while UPT Orar is open.
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={toggleDevice}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? "bg-brand-600" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[1.375rem]" : "left-0.5"}`} />
                </button>
              </label>
            )}
            <p>
              📱 Want reminders even when the app is closed?{" "}
              <Link href="/settings" className="font-medium text-brand-600 hover:underline" onClick={() => setOpen(false)}>
                Export to Google Calendar
              </Link>
              : exams come with alerts a day and 2 hours before.
            </p>
          </div>
        </div>,
        document.body,
      )}

      {toast && mounted && createPortal(
        <div role="status" className="animate-pop fixed right-4 top-16 z-[70] flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-brand-100 bg-white p-3 shadow-xl">
          <Mascot size={36} wave />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-slate-900">{toast.title}</p>
            <p className="text-slate-600">{toast.body}</p>
          </div>
          <button className="text-slate-400 hover:text-slate-700" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>,
        document.body,
      )}
    </div>
  );
}
