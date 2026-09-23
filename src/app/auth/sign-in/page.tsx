import { SignInForm } from "@/modules/auth/components/SignInForm";
import Link from "next/link";
import { env, isDatabaseConfigured } from "@/lib/env";
import { authSettings } from "@/modules/auth/server/session";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = {
  title: "Sign in | Clamp Transparency Signal",
  robots: PRIVATE_ROBOTS,
};

export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const preview = process.env.NODE_ENV === "development" && !isDatabaseConfigured;
  const failed = (await searchParams).error === "signin_failed";
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow">A community looking out for each other</p>
      <h1>Welcome to the map.</h1>
      <p className="auth-description">
        Browse freely. Sign in with Google to share an experience, then choose a public pseudonym.
      </p>
      {preview && <div className="auth-preview">
        Just trying things out? Local preview works without an account or a connected database.
        <Link href="/" className="button button-surface">Continue to local preview</Link>
      </div>}
      <SignInForm configured={authSettings("public").configured} registrationOpen={env.ALLOW_PUBLIC_SIGNUP} failed={failed} />
    </main>
  );
}
