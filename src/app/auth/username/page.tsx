import type { Metadata } from "next";
import { UsernameForm } from "@/modules/auth/components/UsernameForm";
import { PRIVATE_ROBOTS } from "@/modules/seo/policy";

export const metadata: Metadata = { title: "Your public username | Clamp Transparency Signal", robots: PRIVATE_ROBOTS };

export default async function UsernamePage({ searchParams }: { searchParams: Promise<{ edit?: string | string[] }> }) {
  const edit = (await searchParams).edit === "1";
  return (
    <main id="main-content" className="auth-shell">
      <p className="eyebrow">A private account, a public pseudonym</p>
      <h1>{edit ? "Edit your username." : "Choose your username."}</h1>
      <p className="auth-description">{edit ? "Choose a new public pseudonym, or return to the map without changing it." : "Set up a checked public identity before sharing an experience. You can still browse the map without one."}</p>
      <UsernameForm edit={edit} />
    </main>
  );
}
