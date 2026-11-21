import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "../actions";

export const metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { invite } = await searchParams;
  return <AuthForm mode="register" action={registerAction} invite={typeof invite === "string" ? invite : undefined} />;
}
