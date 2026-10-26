import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { resetDb, userByEmail } from './helpers.js';
import { submitApp } from './fixtures.js';

let app: Express;

describe('public: track an application', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('needs both the application number and the permanent ID, and never reveals which one was wrong', async () => {
    const college = await userByEmail('college.abc@demo.in');
    await submitApp(app, college);
    const filed = await prisma.application.findFirstOrThrow({ where: { institutionId: college.institutionId! }, orderBy: { submittedAt: 'desc' }, include: { institution: true } });

    const ok = await request(app).post('/api/public/track').send({ applicationNo: filed.applicationNo.toLowerCase(), permanentId: filed.institution.permanentId });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ applicationNo: filed.applicationNo, stage: expect.any(String), status: expect.any(String), rules: expect.stringMatching(/2027/) });
    expect(ok.body.route.length).toBeGreaterThan(0);
    expect(ok.body).not.toHaveProperty('id');

    const wrongId = await request(app).post('/api/public/track').send({ applicationNo: filed.applicationNo, permanentId: '1-0000000000' });
    const wrongNo = await request(app).post('/api/public/track').send({ applicationNo: 'S-2099-9999', permanentId: filed.institution.permanentId });
    for (const r of [wrongId, wrongNo]) {
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('No application matches that number and permanent ID.');
    }
  });
});
