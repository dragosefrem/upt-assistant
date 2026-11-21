"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";
import { useT } from "@/i18n/client";

type Action = (prev: AuthState, form: FormData) => Promise<AuthState>;

function fieldFeedback(state: AuthState, field: AuthState["field"], hint?: string) {
  const invalid = state.field === field;
  return { "aria-invalid": invalid || undefined, "aria-describedby": [hint, invalid && "auth-error"].filter(Boolean).join(" ") || undefined };
}

function Feedback({ state, loginHref = "/login" }: { state: AuthState; loginHref?: string }) {
  const t = useT();
  return (
    <>
      {state.error && (
        <p id="auth-error" role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error === "tooMany" ? t.auth.errors.tooMany(state.retryMinutes ?? 1) : t.auth.errors[state.error]}
          {state.error === "exists" && <> <Link className="font-medium underline" href={loginHref}>{t.auth.register.signIn}</Link></>}
        </p>
      )}
      {state.sent && (
        <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{t.auth.forgot.sent}</p>
      )}
    </>
  );
}

/** Sign in or create an account. `notice` shows good news from a previous step ("password changed"). */
export function AuthForm({ mode, action, invite, notice }: { mode: "login" | "register"; action: Action; invite?: string; notice?: string }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  const register = mode === "register";
  const inviteQuery = invite ? `?invite=${encodeURIComponent(invite)}` : "";
  return (
    <form action={formAction} noValidate className="space-y-4">
      {invite && <input type="hidden" name="invite" value={invite} />}
      {invite && !state.error && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">{t.auth.register.invited}</p>}
      {notice && !state.error && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
      {register && (
        <div>
          <label className="label" htmlFor="name">{t.auth.fields.name}</label>
          <input id="name" name="name" className="field" autoComplete="name" defaultValue={state.name} required {...fieldFeedback(state, "name")} />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">{t.auth.fields.email}</label>
        <input id="email" name="email" type="email" className="field" autoComplete="email" defaultValue={state.email} required {...fieldFeedback(state, "email")} />
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className="label" htmlFor="password">{t.auth.fields.password}</label>
          {!register && (
            <Link className="text-xs font-medium text-brand-600 hover:underline" href="/forgot">{t.auth.login.forgot}</Link>
          )}
        </div>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete={register ? "new-password" : "current-password"}
          minLength={register ? 8 : undefined}
          {...fieldFeedback(state, "password", register ? "password-hint" : undefined)}
          required
        />
        {register && <p id="password-hint" className="mt-1 text-xs text-slate-500">{t.auth.register.passwordHint}</p>}
      </div>
      <Feedback state={state} loginHref={`/login${inviteQuery}`} />
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? t.common.status.pleaseWait : register ? t.auth.register.submit : t.auth.login.submit}
      </button>
      <p className="text-center text-sm text-slate-600">
        {register ? (
          <>{t.auth.register.haveAccount} <Link className="font-medium text-brand-600 hover:underline" href={`/login${inviteQuery}`}>{t.auth.register.signIn}</Link></>
        ) : (
          <>{t.auth.login.newHere} <Link className="font-medium text-brand-600 hover:underline" href={`/register${inviteQuery}`}>{t.auth.login.create}</Link></>
        )}
      </p>
    </form>
  );
}

/** "Forgot your password?": asks for the account's e-mail address. */
export function ForgotForm({ action }: { action: Action }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">{t.auth.forgot.intro}</p>
      <div>
        <label className="label" htmlFor="email">{t.auth.fields.email}</label>
        <input id="email" name="email" type="email" className="field" autoComplete="email" defaultValue={state.email} required {...fieldFeedback(state, "email")} />
      </div>
      <Feedback state={state} />
      <button className="btn-primary w-full" disabled={pending}>{pending ? t.common.status.pleaseWait : t.auth.forgot.submit}</button>
      <p className="text-center text-sm">
        <Link className="font-medium text-brand-600 hover:underline" href="/login">{t.auth.forgot.back}</Link>
      </p>
    </form>
  );
}

/** Choosing a new password from an e-mailed link. */
export function ResetForm({ action, email }: { action: Action; email: string }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">{t.auth.reset.intro(email)}</p>
      {/* Lets a password manager file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label className="label" htmlFor="password">{t.auth.fields.newPassword}</label>
        <input id="password" name="password" type="password" className="field" autoComplete="new-password" minLength={8} required {...fieldFeedback(state, "password", "password-hint")} />
        <p id="password-hint" className="mt-1 text-xs text-slate-500">{t.auth.register.passwordHint}</p>
      </div>
      <div>
        <label className="label" htmlFor="repeat">{t.auth.fields.repeatPassword}</label>
        <input id="repeat" name="repeat" type="password" className="field" autoComplete="new-password" minLength={8} required {...fieldFeedback(state, "repeat")} />
      </div>
      <Feedback state={state} />
      <button className="btn-primary w-full" disabled={pending}>{pending ? t.common.status.pleaseWait : t.auth.reset.submit}</button>
    </form>
  );
}
