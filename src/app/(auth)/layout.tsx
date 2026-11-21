import Link from "next/link";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Mascot } from "@/components/Mascot";
import { getT } from "@/i18n/server";

/** Frame for signing in, creating an account and resetting a password. */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getT();
  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-12">
      <div className="absolute inset-x-0 top-0 mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900" aria-label={t.auth.backHome} title={t.auth.backHome}>
          <span aria-hidden className="text-slate-400">←</span>
          <span className="text-brand-600">{t.common.appName}</span>
        </Link>
        <LanguageSwitch />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-white shadow-[0_8px_30px_-8px_rgba(31,72,196,0.35)]">
            <Mascot size={72} wave chat={false} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t.auth.hello}</h1>
          <p className="mt-1 text-sm text-slate-600">{t.common.tagline}</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
