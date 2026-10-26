import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { h, parse } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { upload } from '../lib/storage.js';
import { currentUser } from '../auth/middleware.js';
import { scopeWhere, inScope } from '../policy/scope.js';
import { logAccessDenied } from '../policy/roles.js';
import { actionBodySchema, performAction, submitApplication, submitSchema, type UploadInput } from '../workflow/actions.js';
import { caseDetail, listRows } from '../workflow/present.js';

const listQuery = z.object({
  stage: z.enum(['SCRUTINY', 'EVC', 'SAC_SHC', 'DECISION']).optional(),
  status: z.enum(['IN_STAGE', 'RETURNED', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'CLOSED']).optional(),
  type: z.enum(['NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION']).optional(),
  mine: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
});

const fileMetaSchema = z.array(z.object({ kind: z.string().min(1).max(60), expiryDate: z.string().nullable().optional() })).max(20);

/** Pair uploaded files with their {kind, expiryDate} metadata sent as a JSON field. */
export function uploadsFrom(req: Request): UploadInput[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return [];
  let meta: z.infer<typeof fileMetaSchema>;
  try {
    meta = parse(fileMetaSchema, JSON.parse(String(req.body.fileMeta ?? '[]')));
  } catch (e) {
    if (e instanceof SyntaxError) throw badRequest('fileMeta must be JSON.');
    throw e;
  }
  if (meta.length !== files.length) throw badRequest('Each file needs a document kind.');
  return files.map((f, i) => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype, kind: meta[i]!.kind, expiryDate: meta[i]!.expiryDate ?? null }));
}

function jsonField(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    throw badRequest('A form field that should be JSON is not valid JSON.');
  }
}

export function applicationsRouter(): Router {
  const r = Router();

  r.get(
    '/',
    h(async (req, res) => {
      const user = currentUser(req);
      const q = parse(listQuery, req.query);
      const and: Prisma.ApplicationWhereInput[] = [await scopeWhere(user)];
      if (q.stage) and.push({ stage: q.stage });
      if (q.status) and.push({ status: q.status });
      if (q.type) and.push({ type: q.type });
      if (q.q) and.push({ OR: [{ applicationNo: { contains: q.q, mode: 'insensitive' } }, { institution: { name: { contains: q.q, mode: 'insensitive' } } }] });
      if (q.mine === 'true') {
        if (user.role === 'COMMITTEE') {
          and.push({ OR: [{ evcVisit: { memberIds: { array_contains: [user.id] } }, stage: 'EVC', evcScheduled: true }, { stage: 'SAC_SHC', sacForwarded: true }] });
        } else if (user.role === 'AUTHORITY') {
          and.push({ stage: 'DECISION', status: 'IN_STAGE' });
        } else if (user.role !== 'COLLEGE') {
          and.push({ assignments: { some: { officerId: user.id, releasedAt: null } } });
        }
      }
      const apps = await prisma.application.findMany({
        where: { AND: and },
        include: { institution: { select: { name: true, permanentId: true } }, region: { select: { code: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 500,
      });
      res.json({ rows: await listRows(user, apps) });
    }),
  );

  r.get(
    '/:id',
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.id);
      if (!(await inScope(user, id))) {
        await logAccessDenied(user, { applicationId: id, path: req.originalUrl, reason: 'Application outside the user’s scope' });
        throw notFound();
      }
      res.json(await caseDetail(user, id));
    }),
  );

  r.post(
    '/',
    upload.array('files', 20),
    h(async (req, res) => {
      const user = currentUser(req);
      const body = parse(submitSchema, {
        type: req.body.type,
        formData: jsonField(req.body.formData),
        draftId: req.body.draftId,
        justification: req.body.justification || undefined,
      });
      const id = await submitApplication(user, body, uploadsFrom(req));
      res.status(201).json(await caseDetail(user, id));
    }),
  );

  r.post(
    '/:id/actions',
    upload.array('files', 20),
    h(async (req, res) => {
      const user = currentUser(req);
      const id = parse(z.string().uuid(), req.params.id);
      const raw = { action: req.body.action, reason: req.body.reason || undefined, payload: jsonField(req.body.payload) };
      const body = parse(actionBodySchema, raw);
      await performAction(user, id, body.action, { reason: body.reason, payload: body.payload }, uploadsFrom(req));
      if (await inScope(user, id)) res.json(await caseDetail(user, id));
      else res.json({ ok: true, id });
    }),
  );

  return r;
}
