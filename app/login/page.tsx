import { redirect } from "next/navigation";
import { authenticationConfigurationError, getHomeScopeSession } from "../lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getHomeScopeSession();
  if (session && !authenticationConfigurationError()) redirect("/");
  return <LoginForm configured={!authenticationConfigurationError()} />;
}
