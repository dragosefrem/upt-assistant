import { ForgotForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { forgotPasswordAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getT()).auth.forgot.title };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <>
      <h2 className="mb-3 text-base font-semibold text-slate-900">{t.auth.forgot.title}</h2>
      <ForgotForm action={forgotPasswordAction} />
    </>
  );
}
