"use client";

import { Bell, CalendarDays, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useT } from "@/i18n/client";
import { showDeviceNotice } from "@/lib/device-notifications";
import { kindStyle } from "@/lib/kinds";
import { alertKey, historyKeys, isScheduled, noticeCountdown, type Notice } from "@/lib/notification-timing";
import type { NotificationFeed } from "@/lib/notifications";
import { SCHEDULE_CHANGED } from "./Calendar";
import { Mascot } from "./Mascot";
import { OPEN_CHAT } from "./poliFx";

function readKeys(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(saved)) return new Set(saved.filter((value) => typeof value === "string"));
  } catch {}
  return new Set();
}

function writeKeys(key: string, keys: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...keys]));
  } catch {}
}

function remember(key: string, previous: Set<string>, additions: string[]) {
  const merged = new Set([...readKeys(key), ...previous, ...additions]);
  writeKeys(key, merged);
  return merged;
}

function NoticeRow({ notice, now, onClose }: { notice: Notice; now: number; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const scheduled = isScheduled(notice) ? notice : null;
  return (
    <li className="px-4 py-2.5">
      <Link href={notice.href} prefetch={false} onClick={onClose} className="group flex items-start gap-2.5 rounded-md">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${scheduled ? kindStyle(scheduled.kind).dot : "bg-brand-600"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-600">{notice.category}{scheduled && ` · ${noticeCountdown(scheduled, now, locale)}`}</p>
          <p className="break-words text-sm font-semibold text-slate-900 group-hover:text-brand-700">{notice.title}</p>
          <p className="break-words text-xs leading-relaxed text-slate-600">{notice.detail}</p>
        </div>
        <ChevronRight size={15} aria-hidden className="mt-1 text-slate-400 group-hover:text-brand-700" />
      </Link>
      {scheduled?.tip && <p className="ml-[1.125rem] mt-1 text-xs text-slate-600">{scheduled.tip}</p>}
      {(scheduled?.directionsHref || scheduled?.mapsUrl) && (
        <div className="ml-[1.125rem] mt-1 flex flex-wrap gap-x-3 text-xs font-medium text-brand-700">
          {scheduled.directionsHref && <Link href={scheduled.directionsHref} onClick={onClose} className="hover:underline">{t.campus.rooms.showWay}</Link>}
          {scheduled.mapsUrl && <a href={scheduled.mapsUrl} target="_blank" rel="noreferrer" className="hover:underline">{t.exams.card.openMap}</a>}
        </div>
      )}
    </li>
  );
}

export function NotificationBell({ userId, invitationCount }: { userId: string; invitationCount: number }) {
  const messages = useT();
  const t = messages.notifications;
  const locale = useLocale();
  const seenKey = `upt-notify-seen:${userId}`;
  const firedKey = `upt-notify-fired:${userId}`;
  const prefKey = `upt-notify:${userId}`;
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const fired = useRef(new Set<string>());
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [enabling, setEnabling] = useState(false);
  const [deviceError, setDeviceError] = useState(false);
  const [toastKey, setToastKey] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
      if (!res.ok && res.status !== 401) throw new Error();
      const data: NotificationFeed | null = res.ok ? await res.json() : null;
      if (controller.signal.aborted) return;
      if (data?.userId !== userId) {
        setFeed(null);
        setToastKey(null);
        setError(messages.common.status.notSignedIn);
        return;
      }
      setFeed(data);
      setNow(Date.now());
      setError("");
    } catch {
      if (!controller.signal.aborted) setError(messages.common.status.offline);
    }
  }, [userId, messages]);

  useEffect(() => {
    function readPreferences() {
      setVisible(document.visibilityState === "visible");
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      setSeen(readKeys(seenKey));
      try {
        // The old switch was device-wide. Carry that choice forward once for the current student.
        const legacy = localStorage.getItem("upt-notify");
        if (legacy !== null && localStorage.getItem(prefKey) === null) {
          localStorage.setItem(prefKey, legacy);
          localStorage.removeItem("upt-notify");
        }
        setEnabled(localStorage.getItem(prefKey) === "on");
      } catch {}
    }
    readPreferences();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === prefKey || event.key === seenKey) readPreferences();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [prefKey, seenKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, locale change and invitation replies
    void load();
    const refresh = setInterval(load, 60_000);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => {
      const active = document.visibilityState === "visible";
      setVisible(active);
      if (!active) return;
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      void load();
    };
    const onChat = () => { setOpen(false); setToastKey(null); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SCHEDULE_CHANGED, load);
    window.addEventListener(OPEN_CHAT, onChat);
    return () => {
      request.current?.abort();
      clearInterval(refresh);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SCHEDULE_CHANGED, load);
      window.removeEventListener(OPEN_CHAT, onChat);
    };
  }, [load, invitationCount]);

  const due = useMemo(() => {
    if (!feed) return [];
    return [...feed.upcoming, ...feed.requests].flatMap((notice) => {
      const key = alertKey(notice, now);
      return key ? [{ notice, key }] : [];
    });
  }, [feed, now]);
  const unread = due.filter(({ key }) => !seen.has(key));
  const toast = due.find(({ key }) => key === toastKey)?.notice;

  // Keep history only for items in a successful feed. A new request from a former
  // contact can then ring again, and previous weeks' occurrences leave storage.
  useEffect(() => {
    if (!feed) return;
    const active = new Set([...feed.requests, ...feed.upcoming].flatMap(historyKeys));
    function keepActive(keys: Set<string>) {
      const kept = new Set([...keys].filter((key) => active.has(key)));
      return kept.size === keys.size ? keys : kept;
    }
    for (const key of [firedKey, seenKey]) {
      const stored = readKeys(key);
      const kept = keepActive(stored);
      if (kept !== stored) writeKeys(key, kept);
    }
    fired.current = keepActive(fired.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- discard read state for resolved requests
    setSeen(keepActive);
  }, [feed, firedKey, seenKey]);

  useEffect(() => {
    if (!due.length) return;
    const stored = readKeys(firedKey);
    const fresh = due.filter(({ key }) => !fired.current.has(key) && !stored.has(key));
    if (!fresh.length) return;
    fired.current = remember(firedKey, fired.current, fresh.map(({ key }) => key));
    if (open && visible) return;
    // Only the nearest item gets a toast when several reminders arrive at once.
    setToastKey(fresh[0].key);
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const { notice, key } of fresh) {
        const title = isScheduled(notice) ? `${notice.title} · ${noticeCountdown(notice, now, locale)}` : notice.title;
        void showDeviceNotice(title, `${notice.category} · ${notice.detail}`, `${userId}:${key}`, notice.href).catch(() => setDeviceError(true));
      }
    }
  }, [due, enabled, firedKey, locale, now, open, userId, visible]);

  useEffect(() => {
    if (!open || !visible) return;
    const keys = due.map(({ key }) => key).filter((key) => !seen.has(key));
    // Items arriving while the panel is open have also been read.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- record the visible notification keys
    if (keys.length) setSeen(remember(seenKey, seen, keys));
  }, [open, visible, due, seenKey, seen]);

  useEffect(() => {
    if (!toastKey) return;
    const timer = setTimeout(() => setToastKey(null), 8000);
    return () => clearTimeout(timer);
  }, [toastKey]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleDevice = async () => {
    setDeviceError(false);
    if (enabled && permission === "granted") {
      setEnabled(false);
      try { localStorage.setItem(prefKey, "off"); } catch {}
      return;
    }
    if (typeof Notification === "undefined") return;
    setEnabling(true);
    try {
      const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      setPermission(result);
      if (result !== "granted") return;
      await showDeviceNotice(t.testTitle, t.testBody, `${userId}:enabled`, "/");
      setEnabled(true);
      try { localStorage.setItem(prefKey, "on"); } catch {}
    } catch {
      setDeviceError(true);
    } finally {
      setEnabling(false);
    }
  };

  const requests = feed?.requests.filter((r) => r.expiresAt === null || r.expiresAt > now) ?? [];
  const upcoming = feed?.upcoming.filter((r) => r.expiresAt > now) ?? [];
  const deviceOn = enabled && permission === "granted";
  const close = () => setOpen(false);

  return (
    <>
      <button ref={trigger} type="button" onClick={() => {
        if (!open) { setToastKey(null); void load(); }
        setOpen(!open);
      }} className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
        aria-label={unread.length ? t.unread(unread.length) : t.title} title={t.title}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "notification-panel" : undefined}>
        <Bell size={20} aria-hidden />
        {unread.length > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-white">{unread.length}</span>}
      </button>
      {open && createPortal(
        <div id="notification-panel" ref={panel} role="dialog" tabIndex={-1} aria-labelledby="notification-title"
          className="animate-pop fixed inset-x-2 top-16 z-[60] flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:inset-x-auto sm:right-4 sm:w-96">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <div className="flex items-center gap-2"><Mascot size={26} /><h2 id="notification-title" className="font-semibold">{t.title}</h2></div>
            <button type="button" className="btn-ghost px-2" aria-label={messages.common.actions.close} onClick={() => { close(); trigger.current?.focus(); }}><X size={17} aria-hidden /></button>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {error && <p role="status" className="px-4 py-3 text-sm">{error} <button onClick={load} className="font-semibold text-brand-700 underline">{messages.common.actions.retry}</button></p>}
            {!feed && !error && <p role="status" className="px-4 py-3 text-sm">{messages.common.status.loading}</p>}
            {requests.length > 0 && <section>
              <h3 className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700">{t.requests}</h3>
              <ul className="divide-y divide-slate-100">{requests.map((notice) => <NoticeRow key={notice.id} notice={notice} now={now} onClose={close} />)}</ul>
            </section>}
            {upcoming.length > 0 && <section>
              <div className="bg-slate-50 px-4 py-2"><h3 className="text-xs font-semibold text-slate-700">{t.upcoming}</h3><p className="text-xs text-slate-600">{t.horizon}</p></div>
              <ul className="divide-y divide-slate-100">{upcoming.map((notice) => <NoticeRow key={notice.id} notice={notice} now={now} onClose={close} />)}</ul>
            </section>}
            {feed && !error && !upcoming.length && !requests.length && <div className="px-4 py-5">
              <p className="font-medium">{t.empty}</p><p className="mt-1 text-xs text-slate-600">{feed.tip}</p>
            </div>}
            <footer className="space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {permission === "unsupported" ? <p>{t.unsupported}</p> : permission === "denied" ? <p>{t.blocked}</p> : (
                <>
                  <button type="button" role="switch" aria-checked={deviceOn} aria-describedby="notification-timings" disabled={enabling} onClick={toggleDevice}
                    className="flex w-full items-center justify-between gap-3 rounded-md text-left text-sm font-medium text-slate-800">
                    {t.device}
                    <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full transition ${deviceOn ? "bg-brand-600" : "bg-slate-300"}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${deviceOn ? "left-[1.375rem]" : "left-0.5"}`} />
                    </span>
                  </button>
                  <p id="notification-timings">{t.timings}</p>
                </>
              )}
              {deviceError && <p role="status">{t.deviceFailed}</p>}
              <Link href="/settings#export" onClick={close} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                <CalendarDays size={14} aria-hidden />{t.export}
              </Link>
            </footer>
          </div>
        </div>, document.body)}
      {toast && !open && createPortal(
        <div role="status" className="animate-pop fixed right-4 top-16 z-[70] flex w-[min(22rem,calc(100vw-2rem))] items-start gap-2 rounded-2xl border border-brand-100 bg-white p-3 shadow-xl">
          <Mascot size={32} wave />
          <Link href={toast.href} prefetch={false} onClick={() => setToastKey(null)} className="min-w-0 flex-1 break-words text-sm">
            <span className="block font-semibold text-slate-900">{toast.title}{isScheduled(toast) && ` · ${noticeCountdown(toast, now, locale)}`}</span>
            <span className="text-slate-600">{toast.category} · {toast.detail}</span>
          </Link>
          <button aria-label={messages.common.actions.close} onClick={() => setToastKey(null)} className="text-slate-500"><X size={16} aria-hidden /></button>
        </div>, document.body)}
    </>
  );
}
