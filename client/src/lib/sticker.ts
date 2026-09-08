/**
 * Turn an image into a WhatsApp-style sticker: the picture is center-cropped to
 * a square and exported as WebP, so every sticker shares the same square canvas.
 *
 * Animated GIFs come back unchanged — cropping would destroy the animation, so
 * the (square) sticker box crops them visually instead.
 *
 * On any decode/encode failure the original file is returned unchanged rather
 * than dropping the pick.
 */
export async function makeSticker(file: File): Promise<File> {
  if (file.type === "image/gif") {
    return new File([file], file.name, { type: file.type });
  }
  try {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, side, side);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.92),
    );
    if (!blob) return file;
    return new File([blob], "sticker.webp", { type: "image/webp" });
  } catch {
    return file;
  }
}