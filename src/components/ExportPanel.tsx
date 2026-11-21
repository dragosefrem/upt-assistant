"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = { ok: boolean; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-sm ${status.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
      {status.text}
    </p>
  );
}

/** Calendar export: by e-mail, as a file or subscription link, and (when configured) straight to Google. */
export function ExportPanel({
  mailConfigured,
  defaultEmail,
  googleConfigured,
  connected,
  syncedAt,
  feedPath,
  flash,
}: {
  mailConfigured: boolean;
  defaultEmail: string;
  googleConfigured: boolean;
  connected: boolean;
  syncedAt: string | null;
  feedPath: string;
  flash: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [mailStatus, setMailStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Status>(
    flash === "synced"
      ? { ok: true, text: "Connected. Your timetable is now in the “UPT Orar” calendar in Google Calendar." }
      : flash === "denied"
        ? { ok: false, text: "Google access was not granted, so nothing was exported." }
        : flash === "failed"
          ? { ok: false, text: "Connecting to Google failed. Please try again." }
          : flash === "unconfigured"
            ? { ok: false, text: "Google Calendar export is not configured on this server." }
            : null,
  );
  const [copied, setCopied] = useState(false);

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMailStatus(null);
    try {
      const res = await fetch("/api/export/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setMailStatus(
        res.ok
          ? { ok: true, text: `Sent to ${data.sentTo}. Open the attached upt-orar.ics, or import it into your calendar (the email explains how).` }
          : { ok: false, text: data.error ?? "The email could not be sent." },
      );
    } catch {
      setMailStatus({ ok: false, text: "The server could not be reached. Please try again." });
    } finally {
      setSending(false);
    }
  };

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
        <h3 className="text-sm font-semibold text-slate-900">Send to your email</h3>
        <p className="mt-1 text-sm text-slate-600">
          Get your classes, exams, own events and confirmed group events as a calendar file. Open it on your phone, or import it into Google Calendar,
          Apple Calendar or Outlook.
        </p>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={sendEmail}>
          <label htmlFor="export-email" className="sr-only">Email address</label>
          <input
            id="export-email"
            type="email"
            required
            autoComplete="email"
            className="field sm:flex-1"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!mailConfigured || sending}
          />
          <button className="btn-primary shrink-0" disabled={!mailConfigured || sending || !email.trim()}>
            {sending ? "Sending…" : "Email my calendar"}
          </button>
        </form>
        {mailConfigured ? (
          <p className="mt-2 text-xs text-slate-500">
            The file is a snapshot, so send it again after you change courses or events, or subscribe with the link below to stay in sync.
          </p>
        ) : (
          <p className="mt-2 text-xs text-amber-700">
            Email isn&apos;t set up on this server yet (it needs SMTP settings). Meanwhile, download the file below.
          </p>
        )}
        <StatusLine status={mailStatus} />
      </div>

      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Calendar file and subscription link</h3>
        <p className="mt-1 text-sm text-slate-600">
          Works with Google Calendar (<em>Other calendars → From URL</em>), Apple Calendar and Outlook. Anyone with the link can see
          your timetable, so keep it private.
        </p>
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

      {(googleConfigured || connected) && (
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Google Calendar</h3>
          <p className="mt-1 text-sm text-slate-600">
            Creates a separate calendar called “UPT Orar” in your Google account with your classes, exams, personal events and
            confirmed group events you’re attending. The app can only see and change that one calendar.
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
          <p className="mt-2 text-xs text-slate-500">Export again after your timetable or group RSVPs change to update your Google calendar.</p>
        </div>
      )}
      <StatusLine status={message} />
    </div>
  );
}
