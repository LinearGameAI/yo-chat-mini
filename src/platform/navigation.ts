import { startupLog, errorDetails } from '../lib/log';

declare global { interface Window { __MINI_DEBUG_ALLOWED__?: boolean } }

// Custom navigation shares a row with the native capsule, whose position varies by device.
export function initializeNavigationLayout() {
  let attempt = 0;
  let retryTimers: number[] = [];
  const bounds = (element: Element | null) => {
    if (!element) return undefined;
    const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
    return { top, right, bottom, left, width, height };
  };
  const showDiagnostics = (lines: string[]) => {
    if (!window.__MINI_DEBUG_ALLOWED__ || !document.body) return;
    let panel = document.getElementById('mini-navigation-debug');
    if (!panel) {
      panel = document.createElement('pre');
      panel.id = 'mini-navigation-debug';
      panel.setAttribute('aria-label', 'Navigation diagnostics');
      panel.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(116px + env(safe-area-inset-bottom,0px));z-index:9999;display:none;margin:0;padding:8px;border:1px solid #ffffff66;border-radius:6px;background:#000d;color:#8fffaa;font:11px/15px monospace;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none;max-height:40vh;overflow:hidden';
      document.body.appendChild(panel);
      const diagnostics = panel;
      const toggle = document.createElement('button');
      toggle.id = 'mini-navigation-debug-toggle';
      toggle.type = 'button';
      toggle.textContent = '导航信息';
      toggle.setAttribute('aria-controls', panel.id);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.style.cssText = 'position:fixed;left:8px;bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:9999;min-height:36px;padding:6px 10px;border:1px solid #ffffff66;border-radius:6px;background:#151515e6;color:#8fffaa;font:12px/18px sans-serif;pointer-events:auto;touch-action:manipulation';
      toggle.onclick = () => {
        const open = diagnostics.style.display === 'none';
        diagnostics.style.display = open ? 'block' : 'none';
        toggle.textContent = open ? '收起诊断' : '导航信息';
        toggle.setAttribute('aria-expanded', String(open));
      };
      document.body.appendChild(toggle);
    }
    panel.textContent = lines.join('\n');
  };
  const update = (reason: string) => {
    const viewport = window.visualViewport;
    const context = {
      attempt: ++attempt, reason, route: location.hash.split('?')[0],
      sdkPresent: !!window.TTMinis, sdkInitialized: !!window.__MINI_SDK_INITIALIZED__,
      menuAPIPresent: typeof window.TTMinis?.getMenuButtonBoundingClientRect === 'function',
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      documentWidth: document.documentElement.clientWidth, documentHeight: document.documentElement.clientHeight,
      screenWidth: screen.width, screenHeight: screen.height, devicePixelRatio: window.devicePixelRatio,
      visualViewport: viewport ? { width: viewport.width, height: viewport.height, offsetTop: viewport.offsetTop, offsetLeft: viewport.offsetLeft, scale: viewport.scale } : undefined,
    };
    const lines = [
      `NAV #${context.attempt} ${reason}`,
      `viewport ${context.innerWidth}x${context.innerHeight} DPR ${context.devicePixelRatio}`,
      `SDK ${context.sdkPresent} init ${context.sdkInitialized} API ${context.menuAPIPresent}`,
    ];
    showDiagnostics([...lines, 'capsule: waiting for measurement']);
    startupLog('Navigation measurement started', context);
    try {
      const rect = window.TTMinis?.getMenuButtonBoundingClientRect?.();
      lines.push(`capsule: ${rect ? JSON.stringify(rect) : 'not returned'}`);
      lines.push(`visual viewport: ${viewport ? `${viewport.width}x${viewport.height} offset ${viewport.offsetLeft},${viewport.offsetTop} scale ${viewport.scale}` : 'unavailable'}`);
      const invalidFields = rect ? (['top', 'left', 'width', 'height'] as const).filter(field => !Number.isFinite(rect[field])) : [];
      const skipReason = !context.menuAPIPresent ? 'SDK 尚未提供胶囊 API'
        : !rect ? 'SDK 没有返回胶囊坐标'
        : Object.keys(rect).length === 0 ? 'SDK 返回空对象 {}，没有胶囊坐标'
        : invalidFields.length ? `坐标字段缺失或不是数字: ${invalidFields.map(field => `${field}=${String(rect[field])}`).join(', ')}`
        : rect.width <= 0 || rect.height <= 0 ? `胶囊尺寸无效: width=${rect.width}, height=${rect.height}`
        : rect.top < 0 || rect.left <= 0 || rect.left >= window.innerWidth ? `胶囊超出视口: top=${rect.top}, left=${rect.left}, viewportWidth=${window.innerWidth}`
        : undefined;
      if (skipReason) {
        showDiagnostics([...lines, `未应用导航适配: ${skipReason}`,
          `header: ${JSON.stringify(bounds(document.querySelector('.player-top, .chat-header, .drama-list-header, .detail-back'))) || 'not rendered'}`]);
        startupLog('Navigation measurement skipped', { ...context, rect, cause: skipReason }, context.menuAPIPresent ? 'warn' : 'info');
        return;
      }
      if (!rect) return;
      startupLog('Navigation capsule rect received', { ...context, rect: { ...rect } });
      const style = document.documentElement.style;
      const rowHeight = Math.max(44, rect.height);
      const rowTop = Math.max(0, rect.top + (rect.height - rowHeight) / 2);
      style.setProperty('--minis-nav-top', `${rowTop}px`);
      style.setProperty('--minis-nav-height', `${rowHeight}px`);
      style.setProperty('--minis-nav-bottom', `${rowTop + rowHeight}px`);
      style.setProperty('--minis-menu-space', `${window.innerWidth - rect.left + 8}px`);
      document.documentElement.dataset.minisNavbar = 'custom';
      lines.push(`nav top ${rowTop} height ${rowHeight} bottom ${rowTop + rowHeight}`);
      showDiagnostics(lines);
      startupLog('Navigation CSS variables applied', { attempt: context.attempt, reason, rowTop, rowHeight,
        rowBottom: rowTop + rowHeight, menuSpace: window.innerWidth - rect.left + 8 });
      requestAnimationFrame(() => {
        const shell = document.querySelector('.app-shell');
        const header = document.querySelector('.player-top, .chat-header, .drama-list-header, .detail-back');
        const computed = header ? getComputedStyle(header) : undefined;
        showDiagnostics([...lines,
          `header ${header?.className || 'not rendered'}: ${JSON.stringify(bounds(header)) || 'none'}`,
          `back: ${JSON.stringify(bounds(document.querySelector('.player-top .icon-button, .chat-header .icon-button, .detail-back'))) || 'none'}`,
          `padding top ${computed?.paddingTop || '-'} right ${computed?.paddingRight || '-'}`,
        ]);
        startupLog('Navigation rendered layout', { attempt: context.attempt, reason,
          navbar: document.documentElement.dataset.minisNavbar, shell: bounds(shell),
          header: header?.className, headerBounds: bounds(header),
          backButton: bounds(document.querySelector('.player-top .icon-button, .chat-header .icon-button, .detail-back')),
          title: bounds(document.querySelector('.drama-list-brand, .chat-title, .player-top > span')),
          computed: computed ? { top: computed.top, height: computed.height, paddingTop: computed.paddingTop, paddingRight: computed.paddingRight,
            safeTop: computed.getPropertyValue('--safe-top'), navRight: computed.getPropertyValue('--minis-nav-right') } : undefined,
          capsuleCenterY: rect.top + rect.height / 2,
          safeAreaSupported: CSS.supports('padding-top', 'env(safe-area-inset-top)'),
          containerUnitsSupported: CSS.supports('width', '1cqw'),
        });
      });
    } catch (error) {
      showDiagnostics([...lines, `ERROR: ${error instanceof Error ? error.message : String(error)}`]);
      startupLog('Navigation layout unavailable', { ...context, error: errorDetails(error) }, 'warn');
    }
  };
  // SDK loading and native layout readiness can finish after the first render.
  const refresh = (reason: string) => {
    retryTimers.forEach(timer => window.clearTimeout(timer));
    update(reason);
    retryTimers = [250, 1000, 3000].map(delay => window.setTimeout(() => update(`${reason}:retry-${delay}ms`), delay));
  };
  refresh('initialize');
  window.addEventListener('minis-sdk-ready', () => refresh('minis-sdk-ready'));
  window.addEventListener('resize', () => refresh('resize'));
  window.addEventListener('orientationchange', () => refresh('orientationchange'));
  window.visualViewport?.addEventListener('resize', () => refresh('visual-viewport-resize'));
  window.addEventListener('pageshow', () => refresh('pageshow'));
  window.addEventListener('hashchange', () => refresh('route-change'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh('visible'); });
}
