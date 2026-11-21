import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";

export async function generateMetadata() {
  return { title: (await getT()).landing.notFound.title };
}

export default async function NotFound() {
  const [t, user] = await Promise.all([getT(), getUser()]);
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card max-w-md space-y-4 p-8 text-center">
        <Mascot size={72} wave chat={false} />
        <h1 className="text-2xl font-bold tracking-tight">404 · {t.landing.notFound.title}</h1>
        <p className="text-slate-600">{t.landing.notFound.line}</p>
        <Link href={user ? "/" : "/welcome"} className="btn-primary">
          {user ? t.landing.nav.openApp : t.auth.backHome}
        </Link>
      </div>
    </main>
  );
}
