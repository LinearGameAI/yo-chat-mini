import type { Session } from '../shared/types.js';
import { AppError } from './story.js';
export * from '../shared/yoroll.js';

// Filled only by the future server-side TikTok -> Yoroll authentication adapter.
// Never accept this credential from chat request bodies or expose it in bootstrap.
export function requireYorollAuth(session: Session) {
  if (!session.yorollAuth?.accessToken || !session.yorollAuth.userId) {
    throw new AppError(503, 'Yoroll chat authentication is not ready. Please try again later.');
  }
  return session.yorollAuth;
}
