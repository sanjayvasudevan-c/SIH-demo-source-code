import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { NAMED_DEMO_EMAILS } from '../src/auth/demoUsers.js';
import { bearer, resetDb, userByEmail } from './helpers.js';

describe('demo reset [32]', () => {
  it('restores the seed in seconds and every demo user can log in', async () => {
    await resetDb();
    const before = await prisma.user.count();
    await prisma.region.update({ where: { code: 'SOUTH' }, data: { name: 'Changed' } });
    await prisma.simClock.update({ where: { id: 1 }, data: { offsetDays: 30 } });

    const admin = await userByEmail('admin@demo.in');
    const app = createApp();
    const started = process.hrtime.bigint();
    const res = await request(app).post('/api/demo/reset').set(...bearer(admin));
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(10_000);

    expect((await prisma.region.findUniqueOrThrow({ where: { code: 'SOUTH' } })).name).toBe('Southern Region');
    expect((await prisma.simClock.findUniqueOrThrow({ where: { id: 1 } })).offsetDays).toBe(0);
    expect(await prisma.user.count()).toBe(before);

    for (const email of NAMED_DEMO_EMAILS) {
      const r = await request(createApp()).post('/api/auth/login').send({ email, password: 'demo1234' });
      expect(r.status, email).toBe(200);
    }
  });

  it('refuses reset for non-admins', async () => {
    const priya = await userByEmail('priya@demo.in');
    const res = await request(createApp()).post('/api/demo/reset').set(...bearer(priya));
    expect(res.status).toBe(403);
  });
});
