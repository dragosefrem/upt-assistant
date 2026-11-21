import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { loginAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getT()).auth.login.title };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { invite, reset } = await searchParams;
  const code = typeof invite === "string" ? invite : undefined;
  if (await getUser()) redirect(code ? `/join/${code}` : "/");
  const t = await getT();
  return <AuthForm mode="login" action={loginAction} invite={code} notice={reset === "done" ? t.auth.login.resetDone : undefined} />;
}
