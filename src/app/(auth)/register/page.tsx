import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { registerAction } from "../actions";

export async function generateMetadata() {
  return { title: (await getT()).auth.register.title };
}

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { invite } = await searchParams;
  const code = typeof invite === "string" ? invite : undefined;
  if (await getUser()) redirect(code ? `/join/${code}` : "/");
  return <AuthForm mode="register" action={registerAction} invite={code} />;
}
