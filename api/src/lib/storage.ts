// Uploads: PDF, PNG and JPEG only (MIME and extension), 10 MB, random UUID names, never served statically.
// STORAGE_DRIVER=db keeps the bytes in the StoredBlob table instead of on disk (hosted demo: no writable disk, and
// the demo reset then restores files together with the rows that point at them).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { badRequest } from './errors.js';
import { prisma } from './db.js';

const inDb = () => process.env.STORAGE_DRIVER === 'db';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

export function storageDir(): string {
  const dir = process.env.STORAGE_DIR ?? path.resolve(process.cwd(), 'storage');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okExt = ALLOWED[file.mimetype]?.includes(ext);
    if (!okExt) return cb(badRequest(`${file.originalname} is not a PDF, PNG or JPEG file.`));
    cb(null, true);
  },
});

export interface StoredFile {
  storedName: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export async function saveBuffer(buf: Buffer, originalName: string, mimeType: string): Promise<StoredFile> {
  const ext = path.extname(originalName).toLowerCase();
  const storedName = `${crypto.randomUUID()}${ext}`;
  if (inDb()) await prisma.storedBlob.create({ data: { name: storedName, data: buf } });
  else fs.writeFileSync(path.join(storageDir(), storedName), buf);
  return { storedName, fileName: path.basename(originalName).slice(0, 200), mimeType, size: buf.length };
}

export async function removeStored(names: string[]): Promise<void> {
  if (inDb()) await prisma.storedBlob.deleteMany({ where: { name: { in: names } } }).catch(() => undefined);
  else for (const n of names) fs.rmSync(path.join(storageDir(), n), { force: true });
}

function checkName(storedName: string): void {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpe?g)$/.test(storedName)) throw badRequest('Invalid file reference.');
}

export function storedPath(storedName: string): string {
  checkName(storedName);
  return path.join(storageDir(), storedName);
}

/** The stored bytes, or null when the file is missing. */
export async function readStored(storedName: string): Promise<Buffer | null> {
  checkName(storedName);
  if (inDb()) {
    const row = await prisma.storedBlob.findUnique({ where: { name: storedName } });
    return row ? Buffer.from(row.data) : null;
  }
  const p = storedPath(storedName);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

/** Minimal valid one-page PDF with a few lines of text (seed placeholders). */
export function placeholderPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${760 - i * 22} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}
