import { AuthForm } from "@/components/AuthForm";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { invite } = await searchParams;
  return <AuthForm mode="login" action={loginAction} invite={typeof invite === "string" ? invite : undefined} />;
}
