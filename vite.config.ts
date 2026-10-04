import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  return { server: { proxy: { '/api': { target: `http://127.0.0.1:${env.API_PORT || 3001}`, changeOrigin: false } } } };
});
