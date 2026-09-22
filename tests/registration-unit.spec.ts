import { expect, test } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { policyRuntime } from "./helpers/content-policy-runtime";

test("closed registration cannot call signup and its UI does not offer account creation", async () => {
  let calls = 0;
  const runtime = policyRuntime({
    "@/lib/env": { env: { NEXT_PUBLIC_REGISTRATION_ENABLED: false }, isSupabaseConfigured: true },
    "@/lib/supabase/client": { createBrowserClient: () => {
      calls++;
      throw new Error("A closed signup must not contact the provider");
    } },
    "next/navigation": { useRouter: () => ({}) },
    "@/lib/components/Icon": { Icon: () => null },
  });
  const auth = runtime.load<typeof import("../src/modules/auth/lib/supabaseAuth")>("src/modules/auth/lib/supabaseAuth.ts");
  expect((await auth.signUpWithEmail("tester@example.invalid", "synthetic-password")).error).toContain("Registration is closed");
  expect(calls).toBe(0);
  const { SignInForm } = runtime.load<typeof import("../src/modules/auth/components/SignInForm")>("src/modules/auth/components/SignInForm.tsx");
  const markup = renderToStaticMarkup(createElement(SignInForm));
  expect(markup).toContain("invitation-only");
  expect(markup).not.toContain("Create account");
});
