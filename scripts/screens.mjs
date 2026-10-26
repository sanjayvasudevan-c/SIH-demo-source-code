// npm run screens: Playwright screenshots of the main screens at 1440×900 and 390×844, in English and Hindi,
// saved to docs/screens/ for the presentation. Runs against the compose stack (http://localhost:8080) or
// BASE=http://localhost:5173 for the dev server. Read-only apart from signing in.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:8080';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screens');
mkdirSync(out, { recursive: true });

async function token(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (await r.json()).token;
}

async function get(tok, p) {
  const r = await fetch(`${BASE}/api${p}`, { headers: { Authorization: `Bearer ${tok}` } });
  return r.json();
}

const shots = [];
const editor = await token('rules.editor@demo.in');
const cycles = await get(editor, '/rules/cycles');
const v3 = cycles.cycles.find((c) => c.code === '2026-27').versions.find((v) => v.version === 3);
const officer = await token('priya@demo.in');
const apps = await get(officer, '/applications?limit=1');
const caseId = (apps.rows ?? apps)[0]?.id;

shots.push(
  { name: 'home', who: null, path: '/' },
  { name: 'notices', who: null, path: '/notices' },
  { name: 'action-center', who: 'priya@demo.in', path: '/officer' },
  { name: 'case', who: 'priya@demo.in', path: `/cases/${caseId}` },
  { name: 'team', who: 'kumar@demo.in', path: '/team' },
  { name: 'rules-versions', who: 'rules.editor@demo.in', path: '/rules' },
  { name: 'rules-diff', who: 'rules.editor@demo.in', path: `/rules/versions/${v3.id}/diff` },
);

// A draft in review for the impact and review screens: reuse one if present, else create and submit one.
let review = cycles.cycles.flatMap((c) => c.versions).find((v) => v.status === 'IN_REVIEW');
if (!review) {
  const parent = cycles.cycles.find((c) => c.code === '2027-28').published;
  const r = await fetch(`${BASE}/api/rules/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${editor}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentVersionId: parent.id, effectiveFrom: parent.effectiveFrom, amendment: { kind: 'CIRCULAR', refNo: 'SCREENS/1', issuedOn: parent.effectiveFrom, title: 'Longer scrutiny period (screenshot draft)', summary: 'Scrutiny officers get 20 working days instead of 15.', applyScope: { 'timelines.SCRUTINY': 'LIVE' } } }),
  });
  const draft = await r.json();
  await fetch(`${BASE}/api/rules/versions/${draft.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${editor}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ patch: [{ op: 'replace', path: '/timelines/SCRUTINY', value: 20 }] }) });
  await fetch(`${BASE}/api/rules/versions/${draft.id}/submit`, { method: 'POST', headers: { Authorization: `Bearer ${editor}` } });
  review = { id: draft.id };
  console.log('created a draft in review for the screenshots (npm run demo:reset removes it)');
}
shots.push({ name: 'rules-impact', who: 'rules.approver@demo.in', path: `/rules/versions/${review.id}/impact` }, { name: 'rules-review', who: 'rules.approver@demo.in', path: `/rules/versions/${review.id}/review` });

const browser = await chromium.launch();
for (const lang of ['en', 'hi']) {
  for (const vp of [{ width: 1440, height: 900, tag: 'desktop' }, { width: 390, height: 844, tag: 'mobile' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript((l) => localStorage.setItem('approvalsetu.prefs', JSON.stringify({ lang: l, textSize: 'md', contrast: false })), lang);
    const page = await ctx.newPage();
    let signedIn = null;
    for (const s of shots) {
      if (s.who !== signedIn) {
        await page.goto(`${BASE}/`);
        if (s.who) {
          const tok = await token(s.who);
          await page.evaluate((t) => sessionStorage.setItem('aicte.token', t), tok);
        } else {
          await page.evaluate(() => sessionStorage.removeItem('aicte.token'));
        }
        signedIn = s.who;
      }
      await page.goto(`${BASE}${s.path}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      const file = path.join(out, `${s.name}-${lang}-${vp.tag}.png`);
      await page.screenshot({ path: file, fullPage: vp.tag === 'desktop' });
      console.log('saved', path.relative(process.cwd(), file));
    }
    await ctx.close();
  }
}
await browser.close();
