"use client";

import { useActionState } from "react";

export type FormResult = { error?: string };

export function InvitationForm({ action, children, className }: {
  action: (previous: FormResult, form: FormData) => Promise<FormResult>;
  children: React.ReactNode;
  className?: string;
}) {
  const [result, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} aria-busy={pending}>
      <fieldset disabled={pending} className={className}>{children}</fieldset>
      {result.error && <p role="alert" className="mt-2 text-sm text-red-700">{result.error}</p>}
    </form>
  );
}
