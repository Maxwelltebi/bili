import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

async function occupy(port) {
  const server = http.createServer((_req, res) => { res.writeHead(503); res.end('Occupied test port'); });
  return new Promise((resolve, reject) => {
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(null) : reject(error));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test('development startup chooses free ports and proxies to its own API', { timeout: 30000 }, async t => {
  const blockedApi = await occupy(31301);
  const blockedVite = await occupy(5173);
  const child = spawn(process.execPath, ['server/dev.mjs'], { cwd: process.cwd(), env: { ...process.env, API_PORT: '31301', GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await Promise.all([blockedApi, blockedVite].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 20000);
    const inspect = chunk => {
      output += chunk.toString();
      const match = output.match(/Local:[^\n]*?(http:\/\/127\.0\.0\.1:(\d+)\/)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on('data', inspect); child.stderr.on('data', inspect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Startup exited ${code}: ${output}`)); });
  });
  assert.ok(!url.includes(':5173/'), 'Occupied frontend port must be skipped');
  assert.ok(output.includes('using 31302'), 'Occupied API port must be skipped');
  const health = await fetch(`${url}api/health`);
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { configured: false });
  const consultation = await fetch(`${url}api/consult`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: url.slice(0, -1) }, body: JSON.stringify({ answers: [{ id: 'start', prompt: 'Your goal?', choice: 'Understand benefits', text: '' }], document: null, mode: 'next' }) });
  assert.equal(consultation.status, 503); assert.equal((await consultation.json()).code, 'ai_config');
});
