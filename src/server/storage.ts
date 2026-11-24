import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// File storage for admin uploads (design artwork, artist portfolio images).
// Production: Supabase Storage (public bucket) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
// Development: public/uploads on the local disk (not persistent on serverless hosts).

const MAX_BYTES = 3 * 1024 * 1024;

export class UploadError extends Error {}

function sniff(buf: Buffer): { ext: string; type: string } | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { ext: "webp", type: "image/webp" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  return null;
}

/**
 * Stores an uploaded image after validating its real content type (magic bytes, not the
 * file name). SVG uploads are rejected on purpose: they can carry scripts.
 */
export async function storeImage(file: File, folder: "designs" | "portfolio" | "captures", opts: { requireAlpha?: boolean } = {}): Promise<string> {
  if (!file || file.size === 0) throw new UploadError("Choose an image to upload.");
  if (file.size > MAX_BYTES) throw new UploadError("Images must be 3 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw new UploadError("Upload a PNG, WebP or JPEG image.");
  if (opts.requireAlpha && kind.ext === "jpg") throw new UploadError("Mehndi artwork must be a transparent PNG or WebP.");
  const name = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${kind.ext}`;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "public-assets";
  if (url && key) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": kind.type, "x-upsert": "false" },
      body: buf,
    });
    if (!res.ok) throw new UploadError(`Upload failed (${res.status}).`);
    return `${url}/storage/v1/object/public/${bucket}/${name}`;
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_UPLOADS) {
    throw new UploadError("File storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const dest = path.join(process.cwd(), "public", "uploads", name);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, buf);
  return `/uploads/${name}`;
}
