import { SignInForm } from "@/modules/auth/components/SignInForm";

export default function SignInPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Sign in</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        We use email-only magic links — no passwords, and it keeps casual
        bots out. You&apos;ll get a link in your inbox to finish signing in.
      </p>
      <SignInForm />
    </main>
  );
}
