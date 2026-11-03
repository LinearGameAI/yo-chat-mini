import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// A visibly local-only key opens the CLI Playground. It is not a TikTok app identity.
// Restore the CLI's user-level config on exit so local preview does not replace a real app selection.
const rc = path.join(os.homedir(), '.ttminisrc');
const before = fs.existsSync(rc) ? fs.readFileSync(rc) : null;
try { process.loadEnvFile('.env.local'); } catch { /* optional */ }
const local = process.argv.includes('--local');
const clientKey = local ? 'local-preview-only' : process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY;
if (!clientKey || (!local && clientKey.startsWith('local-'))) {
  console.error('Set TIKTOK_CLIENT_KEY in .env.local for real Playground debugging. Browser local mode needs only npm run dev.'); process.exit(1);
}
try {
  const health = await fetch('http://localhost:5173/api/health', { signal: AbortSignal.timeout(1000) });
  const running = await health.json();
  if (running.mode && running.mode !== (local ? 'local' : 'tiktok')) {
    console.error('Port 5173 is already running in a different mode. Stop that dev server before starting this command.'); process.exit(1);
  }
} catch { /* The CLI will start the project when no server is running. */ }
const htmlPath = path.resolve('index.html'); const originalHtml = fs.readFileSync(htmlPath, 'utf8');
const preparedHtml = originalHtml.replaceAll('"local-preview-only"', JSON.stringify(clientKey));
if (!local) fs.writeFileSync(htmlPath, preparedHtml);
const child = spawn(process.execPath, ['node_modules/tiktok-minis-cli/dist/index.js', 'dev', '--client-key', clientKey], {
  stdio: 'inherit', env: { ...process.env, APP_MODE: local ? 'local' : 'tiktok', VITE_TIKTOK_CLIENT_KEY: local ? '' : clientKey },
});
if (local) console.log('LOCAL DIAGNOSTICS ONLY: browser preview at http://localhost:5173. The official Playground requires a real TikTok test account to proceed past its QR screen; no phone simulator is available in CLI 0.0.7. Do not scan the local-only key.');
let restored = false;
function restore() {
  if (restored) return; restored = true;
  if (!local && fs.readFileSync(htmlPath, 'utf8') === preparedHtml) fs.writeFileSync(htmlPath, originalHtml);
  try {
    const current = JSON.parse(fs.readFileSync(rc, 'utf8'));
    if (current.clientKey === clientKey) {
      if (before) fs.writeFileSync(rc, before); else fs.unlinkSync(rc);
    }
  } catch { /* no CLI state was written */ }
}
child.on('exit', code => { restore(); process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); restore(); });
process.on('exit', restore);
