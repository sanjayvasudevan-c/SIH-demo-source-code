// Content hash of a rule pack version: SHA-256 of its canonical JSON (keys sorted, as in the audit chain).
import crypto from 'node:crypto';
import { canonicalJSON } from '../lib/audit.js';

export function contentHash(content: unknown): string {
  return crypto.createHash('sha256').update(canonicalJSON(content)).digest('hex');
}
