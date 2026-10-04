import { createServer } from 'vite';
import { createApp } from './index.mjs';

async function listenAvailable(server, preferred) {
  for (let port = preferred; port < preferred + 40; port++) {
    try {
      await new Promise((resolve, reject) => {
        const fail = error => { server.removeListener('listening', ready); reject(error); };
        const ready = () => { server.removeListener('error', fail); resolve(); };
        server.once('error', fail); server.once('listening', ready);
        server.listen(port, '127.0.0.1');
      });
      return server.address().port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('No available API port. Close an unused local server and retry.');
}

const api = createApp();
let vite;
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.closeAllConnections();
  await Promise.all([new Promise(resolve => api.close(resolve)), vite?.close()]);
  process.exitCode = code;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
  const preferred = Number(process.env.API_PORT || 3001);
  if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65000) throw new Error('API_PORT must be between 1024 and 65000.');
  const port = await listenAvailable(api, preferred);
  process.env.API_PORT = String(port);
  if (port !== preferred) console.log(`API port ${preferred} is occupied; using ${port}.`);
  vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: false, proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: false } } } });
  await vite.listen();
  console.log(`PlanPilot API ready at http://127.0.0.1:${port}. Open the app URL below:`);
  vite.printUrls();
} catch (error) {
  console.error(`PlanPilot could not start: ${error.message}`);
  await stop(1);
}
