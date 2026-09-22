import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { randomFillSync } from "node:crypto";
import { policyRuntime } from "./helpers/content-policy-runtime";
import { PHOTO_LIMITS, validatePhoto } from "../src/modules/photos/policy";

function processor() {
  return policyRuntime({}, { process }).load<typeof import("../src/modules/photos/server/normalize")>("src/modules/photos/server/normalize.ts");
}

test("normal photos are oriented, resized, stripped of private metadata and stored as bounded WebP", async () => {
  const normalize = processor();
  for (const format of ["jpeg", "png", "webp"] as const) {
    const input = await sharp({ create: { width: 5000, height: 100, channels: 3, background: "#184080" } })
      .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "PRIVATE NAME", Copyright: "PRIVATE GPS metadata fixture" } })
      .toFormat(format).toBuffer();
    const output = await normalize.normalizePhoto(new File([new Uint8Array(input)], `photo.${format}`, { type: `image/${format}` }));
    expect(output.byteLength).toBeLessThanOrEqual(PHOTO_LIMITS.storedBytes);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.height).toBe(4096);
    expect(metadata.width).toBeLessThan(100);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(Buffer.from(output).includes(Buffer.from("PRIVATE"))).toBe(false);
  }
});

test("actual HEIC content decodes through the packaged worker without native HEVC libraries", async () => {
  for (const [file, width, height] of [["synthetic", 96, 64], ["64mp", 4096, 4096]] as const) {
    const input = readFileSync(`tests/fixtures/photos/${file}.heic`);
    const result = await processor().normalizePhoto(new File([input], "phone.heic", { type: "" }));
    expect(await sharp(result).metadata()).toMatchObject({ format: "webp", width, height });
    expect(result.byteLength).toBeLessThanOrEqual(PHOTO_LIMITS.storedBytes);
  }
});

test("64-megapixel input is accepted; larger images, corrupt content, TIFF and animations are rejected", async () => {
  const normalize = processor();
  const source = (width: number) => sharp({ create: { width, height: 8000, channels: 3, background: "#184080" } }).png().toBuffer();
  const maximum = await source(8000);
  const accepted = await normalize.normalizePhoto(new File([new Uint8Array(maximum)], "maximum.png", { type: "image/png" }));
  expect(await sharp(accepted).metadata()).toMatchObject({ width: 4096, height: 4096, format: "webp" });
  expect(accepted.byteLength).toBeLessThanOrEqual(PHOTO_LIMITS.storedBytes);
  const oversized = await source(8001);
  const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).tiff().toBuffer();
  const animated = readFileSync("tests/fixtures/photos/animated.webp");
  expect((await sharp(animated).metadata()).pages).toBe(2);
  for (const input of [oversized, tiff, animated, Buffer.from("not a real photo"), Buffer.from("0000ftypheic")]) {
    await expect(Promise.resolve(normalize.normalizePhoto(new File([new Uint8Array(input)], "spoofed.png", { type: "image/png" })))).rejects.toMatchObject({ code: "invalid_photo", status: 422 });
  }
});

test("source size and RAW guards are enforced independently of supplied media type", () => {
  expect(() => validatePhoto(new File([], "photo.jpg", { type: "image/jpeg" }))).toThrow("non-empty");
  expect(() => validatePhoto(new File(["raw"], "photo.dng", { type: "image/dng" }))).toThrow("RAW");
  expect(() => validatePhoto(new File(["heic"], "photo.heic", { type: "" }))).not.toThrow();
  expect(() => validatePhoto(new File([new Uint8Array(PHOTO_LIMITS.sourceBytes + 1)], "photo.jpg", { type: "image/jpeg" }))).toThrow("50 MiB");
});

test("hard-to-compress photos reduce dimensions rather than exceeding the stored byte limit", async () => {
  const pixels = randomFillSync(new Uint8Array(3072 * 3072 * 3));
  const source = await sharp(pixels, { raw: { width: 3072, height: 3072, channels: 3 } }).png().toBuffer();
  const result = await processor().normalizePhoto(new File([new Uint8Array(source)], "noisy.png", { type: "image/png" }));
  expect(result.byteLength).toBeLessThanOrEqual(PHOTO_LIMITS.storedBytes);
  expect(await sharp(result).metadata()).toMatchObject({ width: 2048, height: 2048 });
});
