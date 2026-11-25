"use client";

/**
 * Client-side photo preparation for capture.
 *
 * A phone camera hands over 3–8 MB; the model needs nothing like that to read
 * a poster. Downscaling on-device keeps uploads fast on mobile data and the
 * request comfortably under the server's guard — and it means the original
 * never leaves the phone at all.
 */

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;

export interface PreparedPhoto {
  /** For the preview thumbnail. */
  dataUrl: string;
  /** What the API receives. */
  dataBase64: string;
  mimeType: "image/jpeg";
}

export async function preparePhoto(file: File): Promise<PreparedPhoto | null> {
  try {
    // from-image respects EXIF orientation — without it, half of all phone
    // photos arrive sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return { dataUrl, dataBase64: base64, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
