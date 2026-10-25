/**
 * Photos from the phone: pick one (Photos or the camera), turn Apple's HEIC into JPEG, upload it
 * through OpenWriter's image route, and get back its address.
 *
 * iPhone usually converts HEIC itself when a page asks for "image/*", but not for files picked
 * from the Files app, and the server stores whatever it is sent: a HEIC on the page displays in
 * Safari only. So a HEIC is redrawn to JPEG here (Safari decodes HEIC natively). Large photos are
 * scaled to 2400 px on the long side on the way, which also keeps uploads under the server's
 * 10 MB limit.
 */
import { tabFetch } from './bridge';

const MAX_SIDE = 2400;

export function pickPhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let settled = false;
    const done = (f: File | null) => { if (!settled) { settled = true; input.remove(); resolve(f); } };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function decode(file: File): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file);
      return { draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h), width: bmp.width, height: bmp.height };
    } catch { /* fall back to an <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = url;
    });
    return { draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** A HEIC (or an oversized photo) as a JPEG; anything else unchanged. */
export async function toUploadable(file: File): Promise<File> {
  const heic = isHeic(file);
  if (!heic && file.size < 8 * 1024 * 1024) return file;
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    if (heic) throw new Error('This phone could not read the HEIC photo. Choose it again from Photos, or save it as JPEG first.');
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  decoded.draw(ctx, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

/** Upload a photo; returns its address on the writer's copy (/_images/...). */
export async function uploadPhoto(file: File): Promise<string> {
  const ready = await toUploadable(file);
  const form = new FormData();
  form.append('image', ready);
  const res = await tabFetch('/api/upload-image', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.src) throw new Error(data?.error || 'The photo did not upload.');
  return data.src as string;
}
