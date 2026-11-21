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
      <h1 className="page-heading mb-4">{t.auth.forgot.title}</h1>
      <ForgotForm action={forgotPasswordAction} />
    </>
  );
}
