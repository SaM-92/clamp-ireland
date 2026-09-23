import { expect, test } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { policyRuntime } from "./helpers/content-policy-runtime";

test("Google-only form has no password, email form or client-managed signup", () => {
  const { SignInForm } = policyRuntime().load<typeof import("../src/modules/auth/components/SignInForm")>("src/modules/auth/components/SignInForm.tsx");
  const markup = renderToStaticMarkup(createElement(SignInForm, { configured: true, registrationOpen: false }));
  expect(markup).toContain("Only invited Google accounts");
  expect(markup).toContain("Continue with Google");
  expect(markup).toContain("/api/auth/sign-in");
  expect(markup).not.toContain("<input");
  expect(markup).not.toContain("Create account");
  const unavailable = renderToStaticMarkup(createElement(SignInForm, { configured: false, registrationOpen: false }));
  expect(unavailable).toContain("disabled");
  expect(unavailable).toContain("not configured");
});
