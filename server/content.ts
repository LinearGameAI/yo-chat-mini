import { createContentClient } from '../shared/content.js';
export { ContentAccessError } from '../shared/content.js';
export const { sourceUrl, loadDramaList, safeAsset, fetchSnapshot, normalizeCatalog, loadContent } = createContentClient({
  baseUrl: process.env.YOROLL_API_BASE_URL || 'https://api.lineargame.ai/api/v1',
  language: process.env.YOROLL_CONTENT_LANGUAGE || 'en-US',
});
