import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { readStored, saveBuffer, upload } from '../lib/storage.js';
import { now } from '../lib/clock.js';
import { parseDateOnly } from '../lib/dates.js';
import { currentUser, type AuthUser } from '../auth/middleware.js';
import { inScope } from '../policy/scope.js';
import { logAccessDenied } from '../policy/roles.js';
import { rulesForApp } from '../rules/service.js';

/** A document is readable when its application is in scope, or (institution documents) by the college itself. */
export async function canReadDocument(user: AuthUser, doc: { applicationId: string | null; institutionId: string }): Promise<boolean> {
  if (doc.applicationId) return inScope(user, doc.applicationId);
  if (user.role === 'COLLEGE') return user.institutionId === doc.institutionId;
  const inst = await prisma.institution.findUnique({ where: { id: doc.institutionId } });
  return !!inst && (inst.portfolioOfficerId === user.id || user.role === 'BUREAU' || (user.role === 'HOD' && inst.regionId === user.regionId));
}

export function documentsRouter(): Router {
  const r = Router();

  // A college attaches a document to one of its applications (for example before replying to a deficiency).
  r.post(
    '/',
    upload.single('file'),
    h(async (req, res) => {
      const user = currentUser(req);
      if (user.role !== 'COLLEGE') throw forbidden('Only colleges upload application documents.');
      const body = parse(
        z.object({ applicationId: z.string().uuid(), kind: z.string().min(1).max(60), expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
        { applicationId: req.body.applicationId, kind: req.body.kind, expiryDate: req.body.expiryDate || undefined },
      );
      if (!req.file) throw badRequest('Choose a file to upload.');
      const app = await prisma.application.findUnique({ where: { id: body.applicationId } });
      if (!app || app.institutionId !== user.institutionId) throw notFound();
      if (!(await rulesForApp(app)).documents(app.type, { formData: app.formData as Record<string, unknown> }).some((d) => d.kind === body.kind)) throw badRequest(`${body.kind} is not a document for this application type.`);
      const s = await saveBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
      const doc = await prisma.document.create({
        data: {
          applicationId: app.id,
          institutionId: app.institutionId,
          kind: body.kind,
          ...s,
          uploadedById: user.id,
          uploadedAt: now(),
          expiryDate: body.expiryDate ? parseDateOnly(body.expiryDate) : null,
        },
      });
      res.status(201).json({ id: doc.id, fileName: doc.fileName });
    }),
  );

  r.get(
    '/:id/download',
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.id);
      const doc = await prisma.document.findUnique({ where: { id } });
      if (!doc) throw notFound();
      if (!(await canReadDocument(user, doc))) {
        await logAccessDenied(user, { applicationId: doc.applicationId, path: req.originalUrl, reason: 'Document outside the user’s scope' });
        throw notFound();
      }
      const bytes = await readStored(doc.storedName);
      if (!bytes) throw notFound('The file is missing from storage.');
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    }),
  );

  return r;
}
