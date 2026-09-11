/**
 * Pre-upload image preparation (downscaling).
 *
 * Hosts and reverse proxies frequently cap request bodies around ~1 MB, which
 * rejects camera photos (1–10+ MB) even when the app's own per-file cap is
 * much larger. To make big photos sendable, oversized stills are decoded,
 * scaled down to a sane dimension, and re-encoded as WebP (or JPEG). The
 * result is visually equivalent and usually a few hundred KB.
 *
 * Animated GIFs and anything that fails to decode are passed through untouched
 * so sending never breaks.
 */

const MAX_SIDE = 2560;
/** Only bother when the file is comfortably above the ~1 MB proxy edge cap. */
const COMPRESS_ABOVE = 1_400_000;

/** Prepare a file for upload: returns the re-encoded file when it helps. */
export async function prepareUpload(file: File): Promise<File> {
  if (file.type === "image/gif" || file.size <= COMPRESS_ABOVE) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // WebP keeps transparency (PNG screenshots); JPEG is safer for photos.
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await canvasToBlob(canvas, type, 0.86);
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "");
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}