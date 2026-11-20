"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/(auth)/actions";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "register";
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const register = mode === "register";
  return (
    <form action={formAction} className="space-y-4">
      {register && (
        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" name="name" className="field" autoComplete="name" defaultValue={state.name} required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" className="field" autoComplete="email" defaultValue={state.email} required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          className="field"
          autoComplete={register ? "new-password" : "current-password"}
          minLength={register ? 8 : undefined}
          required
        />
        {register && <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>}
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Please wait…" : register ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-sm text-slate-600">
        {register ? (
          <>Already have an account? <Link className="font-medium text-brand-600 hover:underline" href="/login">Sign in</Link></>
        ) : (
          <>New here? <Link className="font-medium text-brand-600 hover:underline" href="/register">Create an account</Link></>
        )}
      </p>
    </form>
  );
}
