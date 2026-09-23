import { adminSessionSettings } from "@/modules/auth/lib/adminSession";
import { AdminSignIn } from "@admin/auth/AdminSignIn";

export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const failed = (await searchParams).error === "signin_failed";
  return <main id="main-content" className="auth-shell">
    <p className="eyebrow">Private administration</p>
    <h1>Administrator sign-in</h1>
    <p className="auth-description">Access is restricted to the two approved accounts. Community accounts do not receive administrator access.</p>
    <AdminSignIn configured={adminSessionSettings().configured} failed={failed} />
  </main>;
}
