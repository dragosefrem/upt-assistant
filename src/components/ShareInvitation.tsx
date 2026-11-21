"use client";

import { useState } from "react";

export function ShareInvitation({ path, personal = false }: { path: string; personal?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  return (
    <section className="space-y-2 border-t border-slate-200 pt-4">
      <h2 className="font-semibold">{personal ? "Your private RSVP link" : "Guest link"}</h2>
      <p className="text-sm text-slate-600">{personal ? "Save this link to change your RSVP on another device. Keep it private." : "Anyone with this link can join from a browser."}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" onClick={async () => {
          const url = new URL(path, window.location.origin).href;
          try { await navigator.clipboard.writeText(url); setCopied(true); }
          catch { setManual(url); }
        }}>{personal ? "Copy my RSVP link" : "Copy guest link"}</button>
        {!personal && <a href={path} className="btn-ghost">Open invitation</a>}
        {copied && <span role="status" className="text-sm text-teal-800">Link copied</span>}
      </div>
      {manual && <input className="field" aria-label="Link to copy" readOnly onFocus={(e) => e.target.select()} value={manual} />}
    </section>
  );
}
