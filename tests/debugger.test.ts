import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual early HTML loader, including the no-network decision before React starts.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="mini-debugger">([\s\S]*?)<\/script>/)![1];
function debuggerRequested(stage: string, hostname: string, bridge = false, search = '') {
  const scripts: { src?: string }[] = [];
  const browser = { __miniLog() {}, ...(bridge ? { JS2NativeBridge: { call() {} } } : {}) };
  vm.runInNewContext(source.replace('"__MINI_BUILD_STAGE__"', JSON.stringify(stage)), {
    window: browser, location: { hostname, search }, navigator: { userAgent: 'Chrome' },
    document: { createElement: () => ({}), head: { appendChild: (script: { src?: string }) => scripts.push(script) } },
  });
  return scripts.length;
}

test('H5 keeps vConsole in production builds', () => {
  assert.equal(debuggerRequested('production', 'example.com'), 1);
  assert.equal(debuggerRequested('production', 'localhost'), 1);
});

test('production and unknown Minis stages never request the debugger even with debug query flags', () => {
  for (const stage of ['production', '', 'unknown']) {
    assert.equal(debuggerRequested(stage, 'minis-app.tiktok-minis.us', false, '?debug=1&enableDevMode=1'), 0);
    assert.equal(debuggerRequested(stage, 'localhost', true), 0);
  }
});

test('development and preview Minis builds load vConsole', () => {
  for (const stage of ['development', 'preview']) {
    assert.equal(debuggerRequested(stage, 'minis-app.tiktok-minis.us'), 1);
    assert.equal(debuggerRequested(stage, 'localhost', true), 1);
  }
});
