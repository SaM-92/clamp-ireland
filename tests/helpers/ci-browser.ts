import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export const test = base.extend({
  context: async ({ context }, runFixture) => {
    if (process.env.PLAYWRIGHT_CI_SMOKE === "true") {
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
      });
    }
    await runFixture(context);
  },
});
