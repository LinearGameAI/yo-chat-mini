import { startupLog } from '../lib/log';

export const pageStack = ['home', 'watch', 'detail', 'chat'] as const;
export type Page = typeof pageStack[number];
const stateKey = 'yorollMiniPage';

export function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  if (pageStack.includes(hash as Page)) return hash as Page;
  const params = new URLSearchParams(window.location.search);
  return params.has('character_id') ? 'chat' : params.has('drama_id') || params.has('episode_id') ? 'watch' : 'home';
}

function pageUrl(page: Page) {
  return page === 'home' ? `${window.location.pathname}#home` : `${window.location.pathname}${window.location.search}#${page}`;
}

export function initializePageStack() {
  const page = currentPage();
  if (window.history.state?.[stateKey] === page) return page;
  const entry = `${window.location.pathname}${window.location.search}`;
  // A QR/deep link still has the same parents as a page reached from the feed.
  window.history.replaceState({ [stateKey]: 'home' }, '', `${window.location.pathname}#home`);
  for (const parent of pageStack.slice(1, pageStack.indexOf(page) + 1)) {
    window.history.pushState({ [stateKey]: parent }, '', `${entry}#${parent}`);
  }
  startupLog('Page stack initialized', { page, stack: pageStack.slice(0, pageStack.indexOf(page) + 1) });
  return page;
}

export function navigateTo(page: Page) {
  const from = currentPage();
  if (from === page) return;
  // Normalize hash links that were opened without passing through this router.
  if (window.history.state?.[stateKey] !== from) initializePageStack();
  const fromIndex = pageStack.indexOf(from);
  const toIndex = pageStack.indexOf(page);
  startupLog('Page navigation', { from, to: page, direction: toIndex < fromIndex ? 'back' : 'forward', levels: Math.abs(toIndex - fromIndex) });
  if (toIndex < fromIndex) {
    window.history.go(toIndex - fromIndex);
    return;
  }
  for (const next of pageStack.slice(fromIndex + 1, toIndex + 1)) {
    window.history.pushState({ [stateKey]: next }, '', pageUrl(next));
  }
  // pushState does not emit hashchange; React and layout diagnostics need the update.
  window.dispatchEvent(new Event('hashchange'));
}
