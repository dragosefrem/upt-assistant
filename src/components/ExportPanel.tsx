"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { renewCalendarLink } from "@/app/(app)/settings/actions";
import { useLocale, useT } from "@/i18n/client";
import { DATE_LOCALE } from "@/i18n/config";
import type { GoogleSyncMode } from "@/lib/calendar-types";
import { TIME_ZONE } from "@/lib/time";

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
  syncMode,
  syncedAt,
  syncDelayed,
  feedPath,
  flash,
}: {
  mailConfigured: boolean;
  defaultEmail: string;
  googleConfigured: boolean;
  connected: boolean;
  syncMode: GoogleSyncMode;
  syncedAt: string | null;
  syncDelayed: boolean;
  feedPath: string;
  flash: string | null;
}) {
  const t = useT();
  const x = t.settings.export;
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [sending, setSending] = useState(false);
  const [mailStatus, setMailStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState(syncMode);
  const [savingDirection, setSavingDirection] = useState(false);
  const [message, setMessage] = useState<Status>(
    flash && x.flash[flash] ? { ok: flash === "synced", text: x.flash[flash] } : null,
  );
  const [copied, setCopied] = useState(false);
  const [renewed, renew, renewing] = useActionState(renewCalendarLink, false);

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
          ? { ok: true, text: x.email.sent(data.sentTo) }
          : { ok: false, text: data.error ?? x.email.failed },
      );
    } catch {
      setMailStatus({ ok: false, text: t.common.status.offline });
    } finally {
      setSending(false);
    }
  };

  const changeDirection = async (mode: GoogleSyncMode) => {
    if (mode === direction || savingDirection) return;
    const previous = direction;
    setDirection(mode);
    setSavingDirection(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/sync", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: x.google.modeSaved });
      router.refresh();
    } catch {
      setDirection(previous);
      setMessage({ ok: false, text: x.google.modeFailed });
    } finally {
      setSavingDirection(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/sync", { method: "POST" });
      const data = await res.json();
      setMessage(res.ok ? { ok: true, text: direction === "one_way" ? x.google.published : x.google.upToDate } : { ok: false, text: data.error });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: x.google.unreachable });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/google/sync", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: x.google.disconnected });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: x.google.unreachable });
    } finally {
      setBusy(false);
    }
  };

  const feedUrl = typeof window === "undefined" ? feedPath : `${window.location.origin}${feedPath}`;

  return (
    <div className="space-y-5">
      {(googleConfigured || connected) && (
        <div className="border-b border-slate-100 pb-5">
          <h3 className="text-sm font-semibold text-slate-900">{x.google.title}</h3>
          <p className="mt-1 text-sm text-slate-600">{x.google.hint}</p>
          <fieldset className="mt-4" disabled={busy || savingDirection}>
            <legend className="label">{x.google.direction}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["one_way", "two_way"] as const).map(mode => (
                <label key={mode} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${direction === mode ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                  <input name="google-sync-direction" type="radio" value={mode} checked={direction === mode}
                    onChange={() => void changeDirection(mode)} className="mt-1 accent-brand-700" />
                  <span><span className="block font-medium text-slate-900">{x.google.modes[mode].label}</span>
                    <span className="mt-0.5 block text-slate-600">{x.google.modes[mode].hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {connected ? (
              <>
                <button className="btn-primary" onClick={sync} disabled={busy || savingDirection}>{busy ? x.google.syncing : x.google.syncNow}</button>
                <button className="btn-ghost" onClick={disconnect} disabled={busy || savingDirection}>{x.google.disconnect}</button>
                {syncedAt && (
                  <span className="text-xs text-slate-500">
                    {x.google.lastSync(new Date(syncedAt).toLocaleString(DATE_LOCALE[locale], { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }))}
                  </span>
                )}
              </>
            ) : (
              <a className="btn-primary" href={savingDirection ? undefined : "/api/google/connect"} aria-disabled={savingDirection}>{x.google.connect}</a>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">{x.google.refreshHint}</p>
          {syncDelayed && <p className="mt-2 text-sm text-amber-800">{x.google.delayed}</p>}
          <StatusLine status={message} />
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{x.email.title}</h3>
        <p className="mt-1 text-sm text-slate-600">{x.email.hint}</p>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={sendEmail}>
          <label htmlFor="export-email" className="sr-only">{x.email.address}</label>
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
            {sending ? x.email.sending : x.email.send}
          </button>
        </form>
        {mailConfigured ? (
          <p className="mt-2 text-xs text-slate-500">{x.email.snapshot}</p>
        ) : (
          <p className="mt-2 text-xs text-amber-700">{x.email.notConfigured}</p>
        )}
        <StatusLine status={mailStatus} />
      </div>

      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">{x.file.title}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {x.file.hintBefore}<em>{x.file.hintPath}</em>{x.file.hintAfter}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-secondary" href={`${feedPath}?download`}>{x.file.download}</a>
          <button
            className="btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(feedUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? x.file.copied : x.file.copy}
          </button>
        </div>
        <form action={renew} className="mt-3">
          <button className="btn-secondary" disabled={renewing} aria-describedby="renew-hint">{x.file.renew}</button>
          <p id="renew-hint" className="mt-1 text-xs text-slate-600">{x.file.renewHint}</p>
          <p role="status" className="mt-1 text-sm text-emerald-800">{renewed && !renewing && x.file.renewed}</p>
        </form>
      </div>
    </div>
  );
}
