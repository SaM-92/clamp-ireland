import type { Metadata } from "next";
import { UsernameForm } from "@/modules/auth/components/UsernameForm";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = { title: "Your public username | Clamp Transparency Signal", robots: PRIVATE_ROBOTS };

export default function UsernamePage() {
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow">A private account, a public pseudonym</p>
      <h1>Choose your username.</h1>
      <p className="auth-description">Set up a checked public identity before sharing an experience. You can still browse the map without one.</p>
      <UsernameForm />
    </main>
  );
}
