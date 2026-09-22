import { SignInForm } from "@/modules/auth/components/SignInForm";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = {
  title: "Sign in | Clamp Transparency Signal",
  robots: PRIVATE_ROBOTS,
};

export default function SignInPage() {
  const preview = process.env.NODE_ENV === "development" && !isSupabaseConfigured;
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow">A community looking out for each other</p>
      <h1>Welcome to the map.</h1>
      <p className="auth-description">
        Browse freely. Sign in to share an experience. Confirm your email once when you create an account; no extra verification code each time.
      </p>
      {preview && <div className="auth-preview">
        Just trying things out? Local preview works without an account or a connected database.
        <Link href="/" className="button button-surface">Continue to local preview</Link>
      </div>}
      <SignInForm />
    </main>
  );
}
