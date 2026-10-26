import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { resetDb } from './helpers.js';

describe('auth', () => {
  beforeAll(resetDb);

  it('logs in with the demo password and returns the user', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'priya@demo.in', password: 'demo1234' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ name: 'Priya Raman', role: 'OFFICER', regionCode: 'SOUTH' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('priya@demo.in');
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN' } })).toBeGreaterThan(0);
  });

  it('refuses a wrong password and logs LOGIN_FAILED', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'priya@demo.in', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not correct/);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBeGreaterThan(0);
  });

  it('rejects requests without a token', async () => {
    const res = await request(createApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rate limits after 10 attempts in 15 minutes', async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/api/auth/login').send({ email: 'arjun@demo.in', password: 'nope' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'arjun@demo.in', password: 'demo1234' });
    expect(blocked.status).toBe(429);
  });

  it('lists demo users only in demo mode', async () => {
    const res = await request(createApp()).get('/api/auth/demo-users');
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { email: string }) => u.email)).toContain('kumar@demo.in');
  });

  it('serves public health', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ db: 'ok', formcheck: 'down' });
  });
});
