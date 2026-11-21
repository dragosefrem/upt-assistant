import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";

/** Shared frame for sign-in, registration and account recovery. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="welcome-page flex flex-col">
      <header className="border-b border-slate-200">
        <div className="welcome-width flex min-h-18 items-center justify-between gap-3"><Brand /><LanguageSwitch /></div>
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-20">
        <div className="card p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
