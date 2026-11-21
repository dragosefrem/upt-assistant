import Link from "next/link";
import { ResetForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { resetTarget } from "@/lib/password-reset";
import { resetPasswordAction } from "../../actions";

export async function generateMetadata() {
  // Keep the token path private while allowing a same-origin form POST before hydration.
  return { title: (await getT()).auth.reset.title, robots: { index: false }, referrer: "strict-origin" as const };
}

export default async function ResetPasswordPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;
  const t = await getT();
  const target = resetTarget(token);
  if (!target) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="page-heading">{t.auth.reset.invalidTitle}</h1>
        <p className="text-sm text-slate-600">{t.auth.errors.invalid}</p>
        <Link href="/forgot" className="btn-primary w-full">{t.auth.reset.again}</Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="page-heading mb-4">{t.auth.reset.title}</h1>
      <ResetForm action={resetPasswordAction.bind(null, token)} email={target.email} />
    </>
  );
}
