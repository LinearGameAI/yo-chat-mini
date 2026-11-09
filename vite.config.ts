import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; version: string };
  const release = env.VITE_SENTRY_RELEASE || `${packageInfo.name}@${env.VERCEL_GIT_COMMIT_SHA || packageInfo.version}`;
  const minisStage = env.VITE_MINIS_STAGE || (mode === 'development' ? 'development' : 'production');
  if (!['development', 'preview', 'production'].includes(minisStage)) throw new Error('VITE_MINIS_STAGE must be development, preview or production.');
  if (env.VITE_TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_KEY && env.VITE_TIKTOK_CLIENT_KEY !== env.TIKTOK_CLIENT_KEY) throw new Error('Frontend and backend TikTok Client Keys must match.');
  const publicKey = env.VITE_TIKTOK_CLIENT_KEY || env.TIKTOK_CLIENT_KEY || (mode === 'development' ? 'local-preview-only' : '');
  return { plugins: [react(), { name: 'public-minis-client-key', transformIndexHtml: (html: string) => html.replaceAll('"local-preview-only"', JSON.stringify(publicKey)).replace('"__MINI_BUILD_STAGE__"', JSON.stringify(minisStage)) }],
    define: {
      'import.meta.env.VITE_SENTRY_ENVIRONMENT': JSON.stringify(env.VITE_SENTRY_ENVIRONMENT || env.VITE_MINIS_STAGE || env.VERCEL_ENV || (mode === 'development' ? 'development' : 'production')),
      'import.meta.env.VITE_SENTRY_RELEASE': JSON.stringify(release),
    },
    base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true }, build: { sourcemap: false } };
});
