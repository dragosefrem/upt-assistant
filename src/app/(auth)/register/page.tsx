import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "../actions";

export const metadata = { title: "Create account" };

export default function RegisterPage() {
  return <AuthForm mode="register" action={registerAction} />;
}
