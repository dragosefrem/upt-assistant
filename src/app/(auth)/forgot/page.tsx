import { EmailLinkForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { forgotPasswordAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getT()).auth.forgot.title };
}

export default function ForgotPasswordPage() {
  return <EmailLinkForm purpose="reset" action={forgotPasswordAction} />;
}
