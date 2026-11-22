"use client";

import { useState, useTransition } from "react";
import { cancelSponsoredEvent } from "@/app/admin/sponsored-events/actions";
import { useT } from "@/i18n/client";
import { Modal } from "./Modal";

export function CancelSponsoredEvent({ id, title }: { id: string; title: string }) {
  const { sponsored: t, common } = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return <>
    <button type="button" className="btn-ghost" onClick={() => { setFailed(false); setOpen(true); }}>{t.cancel}</button>
    {open && <Modal title={t.cancelTitle} onClose={() => setOpen(false)}>
      <p className="mt-1 text-sm text-slate-700">{t.cancelHint(title)}</p>
      {failed && <p role="alert" className="mt-2 text-sm text-red-700">{common.status.somethingWrong}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>{t.keep}</button>
        <button type="button" disabled={pending} className="btn-danger" onClick={() => startTransition(async () => {
          try { await cancelSponsoredEvent(id); setOpen(false); } catch { setFailed(true); }
        })}>{pending ? common.status.saving : t.cancel}</button>
      </div>
    </Modal>}
  </>;
}
