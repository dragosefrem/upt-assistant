import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { registrationTarget } from "@/lib/account-verification";
import { completeRegistrationAction } from "../../actions";

export async function generateMetadata() {
  return { title: (await getT()).auth.verification.finish, robots: { index: false }, referrer: "strict-origin" as const };
}

export default async function VerifyAccountPage({ params }: PageProps<"/verify/[token]">) {
  const { token } = await params;
  const target = registrationTarget(token);
  if (target) {
    return <AuthForm action={completeRegistrationAction.bind(null, token)} verifiedEmail={target.email} invite={target.invite ?? undefined} />;
  }
  const t = await getT();
  return (
    <div className="space-y-4 text-center">
      <h1 className="page-heading">{t.auth.reset.invalidTitle}</h1>
      <p className="text-sm text-slate-600">{t.auth.errors.invalidVerification}</p>
      <Link href="/register" className="btn-primary w-full">{t.auth.verification.again}</Link>
      <Link href="/login" className="block text-sm font-medium text-brand-600 hover:underline">{t.auth.register.signIn}</Link>
    </div>
  );
}
