import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { consult, AppError } from './consultation.mjs';
import { estimate } from './finance.mjs';
import { createAccountStore, createDemoSessions } from './account.mjs';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'content_type', 'Send a JSON request.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 15 * 1024 * 1024) throw new AppError(413, 'request_size', 'This request is too large. Select a file smaller than 10 MB.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError(400, 'invalid_json', 'The request could not be read.'); }
}

export function createApp({ consultant = consult, estimator = estimate, accounts = createAccountStore(), sessions = createDemoSessions() } = {}) {
  const limits = new Map(); const dist = resolve('dist');
  return http.createServer(async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && ![req.headers.host, '127.0.0.1:5173', 'localhost:5173'].includes(new URL(origin).host)) throw new AppError(403, 'origin', 'This request is not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'origin', 'This request is not allowed.');
        if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { configured: !!process.env.GEMINI_API_KEY });
        if (!['/api/consult', '/api/estimate', '/api/account', '/api/profile', '/api/snapshot'].includes(url.pathname)) return send(res, 404, { message: 'Endpoint not found.' });
        const method = url.pathname === '/api/account' ? 'GET' : ['/api/profile', '/api/snapshot'].includes(url.pathname) ? 'PUT' : 'POST';
        if (req.method !== method) return send(res, 405, { message: `Use ${method} for this endpoint.` });
        const now = Date.now(); for (const [key, value] of limits) if (now - value.start > 60000) limits.delete(key);
        const ip = req.socket.remoteAddress || 'local'; const key = `${ip}:${url.pathname}`; const bucket = limits.get(key) || { start: now, count: 0 };
        const limit = ['/api/estimate', '/api/snapshot'].includes(url.pathname) ? 120 : 30;
        if (++bucket.count > limit) throw new AppError(429, 'rate_limit', 'Please wait a moment before sending another request.'); limits.set(key, bucket);
        if (url.pathname === '/api/account') return send(res, 200, await accounts.bootstrap(sessions.start(req, res)));
        const body = await readJson(req);
        let result;
        if (['/api/profile', '/api/snapshot'].includes(url.pathname)) {
          const id = sessions.read(req);
          if (!id) throw new AppError(401, 'session_expired', 'Reload the app to restore your demo account.');
          result = url.pathname === '/api/profile' ? await accounts.saveProfile(id, body) : await accounts.saveSnapshot(id, body);
        } else if (url.pathname === '/api/estimate') result = await estimator(body);
        else result = await consultant(body, { signal: controller.signal });
        if (!res.destroyed) send(res, 200, result); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { message: 'Method not allowed.' });
      const path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if ((!path.startsWith(dist + sep) && path !== dist) || url.pathname.split('/').some(part => part.startsWith('.'))) return send(res, 404, { message: 'Not found.' });
      let file; let type;
      try { file = await readFile(path); type = MIME[extname(path)] || 'application/octet-stream'; }
      catch { if (extname(url.pathname)) return send(res, 404, { message: 'Not found.' }); file = await readFile(resolve(dist, 'index.html')); type = 'text/html'; }
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': type === 'text/html' ? 'no-cache' : 'public, max-age=3600' }); res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (res.destroyed) return;
      const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError(400, 'validation', 'Some information could not be read. Check your answers and try again.') : new AppError(500, 'server_error', 'Something went wrong. Your answers are still here; please retry.');
      send(res, safe.status, { code: safe.code, message: safe.message });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.API_PORT || 3001);
  const server = createApp();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `PlanPilot port ${port} is occupied. Close the previous server or set API_PORT to another port.` : 'PlanPilot could not start. Check the server configuration.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`PlanPilot: http://127.0.0.1:${port}`));
}
