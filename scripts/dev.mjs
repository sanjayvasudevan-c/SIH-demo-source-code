// npm run dev: api, scheduler and web locally against the compose database; formcheck via uvicorn.
import { spawn } from 'node:child_process';

const procs = [
  ['api', 'npm', ['--workspace', 'api', 'run', 'dev']],
  ['scheduler', 'npm', ['--workspace', 'api', 'run', 'dev:scheduler']],
  ['web', 'npm', ['--workspace', 'web', 'run', 'dev']],
  ['formcheck', 'python3', ['-m', 'uvicorn', 'app.main:app', '--port', '8000', '--app-dir', 'formcheck']],
];

const children = procs.map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHARED_DIR: new URL('../shared', import.meta.url).pathname } });
  const tag = `[${name}] `;
  p.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^/gm, tag)));
  p.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^/gm, tag)));
  p.on('exit', (code) => console.log(`${tag}exited with ${code}`));
  return p;
});

process.on('SIGINT', () => {
  for (const c of children) c.kill('SIGINT');
  process.exit(0);
});
