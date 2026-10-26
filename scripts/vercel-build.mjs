// Vercel build (hosted demo): emits .vercel/output in the Build Output API format.
//   static/            the web app (vite build)
//   functions/api.func one Node function: the Express API bundled with esbuild, plus the Prisma client and engine
//   config.json        /api/* → the function, files from static/, everything else → index.html (client routing);
//                      a daily cron for the deadline engine
// Before bundling it prepares the Neon database (api/scripts/hosted-prepare.ts).
// The Vercel project's root directory is web/ so that Vercel does not treat api/**/*.ts as functions.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Written next to the directory the build runs in (the Vercel project's root directory is web/).
const out = path.join(process.cwd(), '.vercel/output');
const fn = path.join(out, 'functions/api.func');
const run = (cmd, cwd = root) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

run('npx prisma generate', path.join(root, 'api'));
run('npx tsx scripts/hosted-prepare.ts', path.join(root, 'api'));

run('npm --workspace web run build');
fs.cpSync(path.join(root, 'web/dist'), path.join(out, 'static'), { recursive: true });

run(
  [
    'npx esbuild api/src/serverless.ts --bundle --platform=node --target=node22 --format=esm',
    `--outfile=${fn}/index.mjs`,
    '--external:@prisma/client --external:.prisma/client --external:pg-native',
    // CommonJS dependencies bundled into ESM still call require().
    `--banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"`,
  ].join(' '),
);
// Prisma's generated client and query engine are loaded at runtime from node_modules next to the function.
for (const dir of ['@prisma/client', '.prisma/client']) {
  fs.cpSync(path.join(root, 'node_modules', dir), path.join(fn, 'node_modules', dir), { recursive: true, dereference: true });
}
// Only the engine for Vercel's runtime (Amazon Linux, OpenSSL 3) is needed.
for (const f of fs.readdirSync(path.join(fn, 'node_modules/.prisma/client'))) {
  if (!process.env.KEEP_ALL_ENGINES && f.includes('query_engine') && !f.includes('rhel-openssl-3.0.x')) fs.rmSync(path.join(fn, 'node_modules/.prisma/client', f));
}
// Data files the API reads at runtime (expression variables, form-check samples, seed inputs).
fs.cpSync(path.join(root, 'shared'), path.join(fn, 'shared'), { recursive: true });
fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60, supportsResponseStreaming: false }, null, 2),
);

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(/.*)?$', dest: '/api' },
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
      crons: [{ path: '/api/cron/tick', schedule: '17 3 * * *' }],
    },
    null,
    2,
  ),
);
console.log('[vercel-build] .vercel/output ready');
