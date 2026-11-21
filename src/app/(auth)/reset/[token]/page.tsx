import Link from "next/link";
import { ResetForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { resetTarget } from "@/lib/password-reset";
import { resetPasswordAction } from "../../actions";

export async function generateMetadata() {
  // The link carries a secret: keep it out of search engines and out of referrers.
  return { title: (await getT()).auth.reset.title, robots: { index: false }, referrer: "no-referrer" as const };
}

export default async function ResetPasswordPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;
  const t = await getT();
  const target = resetTarget(token);
  if (!target) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-base font-semibold text-slate-900">{t.auth.reset.invalidTitle}</h2>
        <p className="text-sm text-slate-600">{t.auth.errors.invalid}</p>
        <Link href="/forgot" className="btn-primary w-full">{t.auth.reset.again}</Link>
      </div>
    );
  }
  return (
    <>
      <h2 className="mb-3 text-base font-semibold text-slate-900">{t.auth.reset.title}</h2>
      <ResetForm action={resetPasswordAction.bind(null, token)} email={target.email} />
    </>
  );
}
