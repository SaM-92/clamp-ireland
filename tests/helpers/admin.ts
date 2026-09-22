import type { Page } from "@playwright/test";

export const adminBaseURL = "http://127.0.0.1:3016";
export const adminUrl = (path: string) => `${adminBaseURL}${path}`;

export async function authorizeAdmin(page: Page, token = "owner-session") {
  await page.context().addCookies([{
    name: "clamp-admin-session", value: token, url: adminBaseURL,
    httpOnly: true, sameSite: "Strict",
  }]);
}
