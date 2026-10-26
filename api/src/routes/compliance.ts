import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { today } from '../lib/clock.js';
import { calendarDaysBetween, isoDate } from '../lib/dates.js';
import { upload } from '../lib/storage.js';
import { rulesForApp } from '../rules/service.js';
import { currentUser } from '../auth/middleware.js';
import { requireRole } from '../policy/roles.js';
import { uploadEvidence, uploadRenewal, verifyEvidence, verifyRenewal, type UploadInput } from '../workflow/actions.js';

function fileOf(req: Express.Request): UploadInput | undefined {
  const f = (req as Express.Request & { file?: Express.Multer.File }).file;
  return f ? { buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype, kind: 'EVIDENCE' } : undefined;
}

const verifyBody = z.object({ accept: z.boolean(), remarks: z.string().trim().max(2000).optional() });

export function complianceRouter(): Router {
  const r = Router();

  // The college's compliance view: undertakings and documents with expiry on its approved applications.
  r.get(
    '/compliance',
    requireRole('COLLEGE'),
    h(async (req, res) => {
      const user = currentUser(req);
      const t = today();
      const apps = await prisma.application.findMany({
        where: { institutionId: user.institutionId ?? '-', status: { in: ['APPROVED', 'APPROVED_WITH_CONDITIONS', 'CLOSED'] } },
        include: { undertakings: { orderBy: { dueDate: 'asc' } }, documents: true },
        orderBy: { applicationNo: 'asc' },
      });
      const undertakings = apps.flatMap((a) =>
        a.undertakings.map((u) => ({
          id: u.id,
          applicationId: a.id,
          applicationNo: a.applicationNo,
          condition: u.condition,
          dueDate: isoDate(u.dueDate),
          daysToDue: calendarDaysBetween(t, u.dueDate),
          status: u.status,
          remarks: u.remarks,
        })),
      );
      const docLabels = new Map<string, Map<string, string>>();
      for (const a of apps) docLabels.set(a.id, new Map((await rulesForApp(a)).content.documents.map((d) => [d.kind, d.label])));
      const documents = apps.flatMap((a) => {
        const superseded = new Set(a.documents.map((d) => d.supersedesId).filter(Boolean));
        return a.documents
          .filter((d) => d.expiryDate && d.verified && !superseded.has(d.id))
          .map((d) => {
            const pending = a.documents.find((x) => x.supersedesId === d.id && !x.verified);
            return {
              id: d.id,
              applicationId: a.id,
              applicationNo: a.applicationNo,
              kind: d.kind,
              label: docLabels.get(a.id)?.get(d.kind) ?? d.kind,
              fileName: d.fileName,
              expiryDate: isoDate(d.expiryDate!),
              daysToExpiry: calendarDaysBetween(t, d.expiryDate!),
              renewalPending: pending ? { id: pending.id, expiryDate: isoDate(pending.expiryDate!) } : null,
            };
          });
      });
      documents.sort((x, y) => x.daysToExpiry - y.daysToExpiry);
      res.json({ undertakings, documents });
    }),
  );

  r.post(
    '/undertakings/:id/evidence',
    requireRole('COLLEGE'),
    upload.single('file'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      await uploadEvidence(currentUser(req), id, fileOf(req), typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : undefined);
      res.status(201).json({ ok: true });
    }),
  );

  r.post(
    '/undertakings/:id/verify',
    requireRole('OFFICER', 'BUREAU'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      await verifyEvidence(currentUser(req), id, parse(verifyBody, req.body));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/documents/:id/renewal',
    requireRole('COLLEGE'),
    upload.single('file'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      await uploadRenewal(currentUser(req), id, fileOf(req), String(req.body.expiryDate ?? ''));
      res.status(201).json({ ok: true });
    }),
  );

  r.post(
    '/documents/:id/verify-renewal',
    requireRole('OFFICER', 'BUREAU'),
    h(async (req, res) => {
      const id = parse(z.string().uuid(), req.params.id);
      await verifyRenewal(currentUser(req), id, parse(verifyBody, req.body));
      res.json({ ok: true });
    }),
  );

  return r;
}
