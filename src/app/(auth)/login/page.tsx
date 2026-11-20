import { AuthForm } from "@/components/AuthForm";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AuthForm mode="login" action={loginAction} />;
}
