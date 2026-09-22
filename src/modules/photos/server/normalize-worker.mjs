import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import decodeHeic from "heic-decode";

sharp.cache(false);
sharp.concurrency(1);

const { bytes, limits } = workerData;
const input = Buffer.from(bytes);
let heicImages;

try {
  let image;
  const heic = input.toString("ascii", 4, 8) === "ftyp"
    && ["mif1", "heic", "heix", "msf1", "hevc", "hevx"].includes(input.toString("ascii", 8, 12));
  if (heic) {
    heicImages = await decodeHeic.all({ buffer: input });
    if (heicImages.length !== 1) throw new Error("frames");
    const { width, height } = heicImages[0];
    if (width < 1 || height < 1 || width * height > limits.pixels) throw new Error("pixels");
    const decoded = await heicImages[0].decode();
    image = sharp(decoded.data, { raw: { width, height, channels: 4 }, limitInputPixels: limits.pixels });
  } else {
    const format = input.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? "jpeg"
      : input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
      : input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    if (!format) throw new Error("format");
    const metadata = await sharp(input, { limitInputPixels: false, failOn: "warning" }).metadata();
    if (metadata.format !== format) throw new Error("format");
    if ((metadata.pages ?? 1) !== 1) throw new Error("frames");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > limits.pixels) throw new Error("pixels");
    image = sharp(input, { limitInputPixels: limits.pixels, failOn: "warning", sequentialRead: true });
  }
  const prepared = image.rotate().flatten({ background: "#ffffff" }).toColourspace("srgb");
  let encoded;
  for (const [dimension, quality] of [[limits.maxDimension, 82], [limits.maxDimension, 68], [2048, 68]]) {
    const candidate = await prepared.clone()
      .resize(dimension, dimension, { fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 4 }).toBuffer();
    if (candidate.length <= limits.storedBytes) {
      encoded = new Uint8Array(candidate);
      break;
    }
  }
  if (!encoded) throw new Error("output");
  parentPort.postMessage({ ok: true, bytes: encoded }, [encoded.buffer]);
} catch (error) {
  const reason = error instanceof Error && ["pixels", "frames", "format", "output"].includes(error.message)
    ? error.message : "decode";
  parentPort.postMessage({ ok: false, reason });
} finally {
  heicImages?.dispose();
}
