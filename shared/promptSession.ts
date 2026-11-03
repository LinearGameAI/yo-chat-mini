// Extracted from Yoroll main e6199716.
const WATCH_BEFORE_PROMPT_MS = 10_000;

/** 单部剧在本次 App 使用期间的实际观看时间；换集或返回播放页不会重复弹窗。 */
export class DramaChatPromptSession {
  private watchedMs = 0;
  private watchingSince: number | null = null;
  private shown = false;

  get hasShown() { return this.shown; }

  update(now: number, watching: boolean) {
    if (this.watchingSince !== null) {
      this.watchedMs += Math.max(0, now - this.watchingSince);
    }
    this.watchingSince = watching && !this.shown ? now : null;
  }

  claim(): boolean {
    if (this.shown || this.watchedMs < WATCH_BEFORE_PROMPT_MS) return false;
    this.shown = true;
    this.watchingSince = null;
    return true;
  }
}

const sessions = new Map<string, DramaChatPromptSession>();

export function dramaChatPromptSession(dramaId: string): DramaChatPromptSession {
  let session = sessions.get(dramaId);
  if (!session) {
    session = new DramaChatPromptSession();
    sessions.set(dramaId, session);
  }
  return session;
}
