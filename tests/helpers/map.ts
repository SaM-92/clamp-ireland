import { expect, type Page } from "@playwright/test";

export async function expectStreetDetail(page: Page) {
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const screenshot = await page.locator(".maplibregl-canvas").screenshot();
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 100, 100);
      const pixels = context.getImageData(0, 0, 100, 100).data;
      const colors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4) {
        colors.add(`${pixels[index] >> 4},${pixels[index + 1] >> 4},${pixels[index + 2] >> 4}`);
      }
      return colors.size;
    }, screenshot.toString("base64"));
  }, { message: "The rendered map must show street detail, not a flat background", timeout: 15_000 }).toBeGreaterThan(30);
}
