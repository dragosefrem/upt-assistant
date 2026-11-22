import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { registrationTarget } from "@/lib/account-verification";
import { getUser } from "@/lib/auth";
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
  // The link has done its job: a student who opens it again while signed in is not told that it
  // "expired" and to ask for a new one.
  const user = await getUser();
  if (user) redirect(user.onboardedAt ? "/" : "/onboarding");
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
