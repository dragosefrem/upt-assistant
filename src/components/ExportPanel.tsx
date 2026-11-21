"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Google Calendar connection and .ics feed controls. */
export function ExportPanel({
  googleConfigured,
  connected,
  syncedAt,
  feedPath,
  flash,
}: {
  googleConfigured: boolean;
  connected: boolean;
  syncedAt: string | null;
  feedPath: string;
  flash: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    flash === "synced"
      ? { ok: true, text: "Connected. Your timetable is now in the “Poli” calendar in Google Calendar." }
      : flash === "denied"
        ? { ok: false, text: "Google access was not granted, so nothing was exported." }
        : flash === "failed"
          ? { ok: false, text: "Connecting to Google failed. Please try again." }
          : flash === "unconfigured"
            ? { ok: false, text: "Google Calendar export is not configured on this server." }
            : null,
  );
  const [copied, setCopied] = useState(false);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/sync", { method: "POST" });
      const data = await res.json();
      setMessage(res.ok ? { ok: true, text: `Exported ${data.events} item(s) to Google Calendar.` } : { ok: false, text: data.error });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Google Calendar could not be reached." });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/google/sync", { method: "DELETE" }).catch(() => {});
    setBusy(false);
    setMessage({ ok: true, text: "Disconnected. The calendar already in your Google account was left in place." });
    router.refresh();
  };

  const feedUrl = typeof window === "undefined" ? feedPath : `${window.location.origin}${feedPath}`;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Google Calendar</h3>
        {googleConfigured ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Creates a separate calendar called “Poli” in your Google account and fills it with your classes, exams and
              personal events. The app can only see and change that one calendar.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {connected ? (
                <>
                  <button className="btn-primary" onClick={sync} disabled={busy}>{busy ? "Exporting…" : "Export again"}</button>
                  <button className="btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
                  {syncedAt && <span className="text-xs text-slate-500">Last export {new Date(syncedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>}
                </>
              ) : (
                <a className="btn-primary" href="/api/google/connect">Connect Google Calendar</a>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">Export again after you change groups, courses or personal events — it replaces the previous export.</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Direct export is not set up on this server (it needs Google OAuth credentials). You can still add your timetable to
            Google Calendar with the subscription link below: in Google Calendar choose <em>Other calendars → From URL</em>.
          </p>
        )}
        {message && (
          <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{message.text}</p>
        )}
      </div>

      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Calendar file and subscription link</h3>
        <p className="mt-1 text-sm text-slate-600">Works with Google Calendar, Apple Calendar and Outlook. Anyone with the link can see your timetable, so keep it private.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-secondary" href={`${feedPath}?download`}>Download .ics</a>
          <button
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(feedUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Link copied" : "Copy subscription link"}
          </button>
        </div>
      </div>
    </div>
  );
}
