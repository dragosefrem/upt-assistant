"use client";

/* eslint-disable @next/next/no-img-element -- the code is an SVG made per address by our own API */
import { useState } from "react";
import { useT } from "@/i18n/client";
import { qrUrl } from "./api";
import { Modal } from "../Modal";
import { slug } from "./format";

/** The route's address as a QR code to scan from the screen, print or put in a timetable. */
export function ShareDialog({
  open,
  onClose,
  link,
  title,
  goal,
  onCopy,
  copied,
}: {
  open: boolean;
  onClose: () => void;
  /** The full address, with the app's origin. */
  link: string;
  title: string;
  goal: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const t = useT().campus;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === link;
  // A code for an address on this computer is of no use to the phone that scans it.
  const local = /^https?:\/\/(localhost|[^/]+\.localhost|127(\.\d+){3}|\[::1\])(:\d+)?\//.test(link);

  return (
    <Modal open={open} title={t.share.title} onClose={onClose}>
      <p className="break-words text-sm font-semibold text-slate-800">{title}</p>
      {open && !failed && (
        <img
          src={qrUrl(link, "svg")}
          alt={t.share.qrAlt(title)}
          width={232}
          height={232}
          className="mx-auto my-4 h-58 w-58 rounded-2xl border border-slate-200 bg-white p-2"
          onError={() => setFailedFor(link)}
        />
      )}
      <p role="status" className="text-sm text-slate-600">
        {failed ? t.share.qrFailed : t.share.qrHint}
      </p>
      {local && !failed && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.share.qrLocal}</p>}
      <p className="mt-3 select-all break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{link}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={onCopy}>
          🔗 {copied ? t.share.copied : t.share.copyLink}
        </button>
        {!failed && (
          <a className="btn-primary" href={qrUrl(link, "png")} download={`upt-campus-${slug(goal) || "walk"}.png`}>
            ⬇ {t.share.saveImage}
          </a>
        )}
      </div>
    </Modal>
  );
}
