// Extracted without native dependencies from Yoroll main e6199716 src/api/shortDrama.ts.
function joinUrl(base: string, path: string): string { return `${base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`; }
/** defaultChoice 的哨兵值:不倒计时,必须由用户自己选。 */
export const NO_DEFAULT_CHOICE = '-1';

/**
 * 选项节点的倒计时秒数;0 = 不倒计时。
 *
 * 两种情况都是 0:后端显式给了 defaultChoice: '-1'(这一步必须用户自己选),
 * 或者压根没配 duration。**倒计时逻辑和倒计时 UI 必须用同一个函数**,
 * 否则会出现「进度条走完了却什么都没发生」这种更糟的状态。
 */
export function choiceCountdownSeconds(node: {
  duration?: number;
  defaultChoice?: string;
}): number {
  if (node.defaultChoice === NO_DEFAULT_CHOICE) return 0;
  return typeof node.duration === 'number' && node.duration > 0 ? node.duration : 0;
}

/** 互动选项:label 展示、next 指向下一个 node 的 id、key 与 defaultChoice 对应。 */
export interface DramaChoice {
  key: string;
  label: string;
  next: string; // 下一个 node 的 id
}

/** QTE 互动。视频播完在指定位置弹交互 UI + 环形倒计时,按结果走下一个 node。
 *  - click:圆形按钮。点中=成功、点别处=失败、超时=超时。
 *  - swipe:方向箭头。整视频区域接手势,方向对且够远=成功、否则失败、不滑超时=超时。
 *  next_node_map:'0'=失败、'1'=成功、'2'=超时。 */
export type DramaQteType = 'click' | 'swipe';
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';
export interface DramaQte {
  type: DramaQteType;
  duration: number; // 展示时长(秒),驱动环形倒计时
  /** 中心相对视频区域的比例:x=宽方向(0..1)、y=高方向(0..1)。 */
  areaPosition: { x: number; y: number };
  /** 按钮尺寸缩放(click 用;默认 50px 基础上乘缩放,正圆取 x)。swipe 无此字段 → {0,0}。 */
  areaSize: { x: number; y: number };
  /** swipe 专属。 */
  swipeDirection?: SwipeDirection;
  swipeAngleTolerance?: number; // 方向容差(度)
  swipeMinDistance?: number; // 判定为成功的最小滑动距离(px)
  successNext?: string; // next_node_map['1']
  failNext?: string; // next_node_map['0']
  timeoutNext?: string; // next_node_map['2']
}

/** 取非空字符串,否则 undefined。 */
function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** 结局类型(node.end_type)。 */
export type DramaEndType = 'death' | 'chapter' | 'game';

/** 一个互动视频切片节点。choices(选择)与 qte(点击)互斥,至多其一。 */
/** 字幕语言。发布侧当前只产出这两种,未知语言一律忽略。 */
export type DramaSubtitleLanguage = 'zh' | 'en';

/**
 * 节点字幕的绝对 URL(已按 cdnBase 归一)。
 *
 * 发布数据里是相对章节 JSON 目录的路径(如 `Subtitles/episode-01.zh.srt`),
 * 这里统一解析成绝对 URL —— 和 coverImage 一样走 resolveNodeAsset,
 * **不要拿视频 URL 去替换目录猜字幕地址**,一切以 nodes[].subtitles 为准。
 */
export type DramaSubtitleUrls = Partial<Record<DramaSubtitleLanguage, string>>;

export interface DramaNode {
  id: string; // 节点 id(startNodeId / choice.next 都指向它)
  title?: string; // 节点名(分支列表每行展示;数据里通常是视频文件名如 S14.mp4)
  video: string; // 视频文件名;播放 url = cdnBase + '/' + video
  coverImage?: string; // 节点首帧封面;已归一为绝对 url(绝对直接用,相对拼 cdnBase 同视频 base)
  /** 线性后继节点 id:无 choices/qte 的节点播完直接推进到它(如"引子节点 → 选项节点"的编排)。
   *  数据里 "-1" 或缺省 = 无后继(分支末尾),归一为 undefined。 */
  next?: string;
  question?: string; // 有 choices 时,弹层顶部的提问
  duration?: number; // 视频结束后等待用户选择的秒数;超时用 defaultChoice
  /**
   * 超时默认选的 choice.key。
   *
   * **'-1' 是哨兵**:表示这一步必须由用户自己选 —— 不倒计时、不自动兜底,一直等到有人点。
   * 与 next 的 '-1'(无后继)是同一套约定。判断统一走 choiceCountdownSeconds()。
   */
  defaultChoice?: string;
  choices?: DramaChoice[]; // 无/空且无 next = 该节点是分支末尾,播完进下一章
  qte?: DramaQte; // QTE 点击互动;仅 type==='click' 时解析,其余当普通线性节点
  /** 结局节点(可选):有值表示本节点播完即结束 —— 不走 choices/qte/next、也不连播下一集,
   *  停在最后一帧并在其上渲染结局层。未知值忽略(按普通节点处理,脏数据不该卡死播放)。 */
  endType?: DramaEndType;
  /** 结局文案:按 endType 取对应字段 —— game→game_desc、chapter→chapter_desc、
   *  death→death_desc。解析时已按类型择一取好,UI 直接用。 */
  endDesc?: string;
  /**
   * 字幕文件的绝对 URL,按语言索引。**可选** —— 未开启字幕的构建没有这个字段,
   * 那种短剧照常播放、不显示字幕,不算错误。
   *
   * 注意 URL 里含发布版本号(如 `/v16/`),字幕校对会产生新版本 —— 所以拿完整 URL
   * 当缓存 key 就能天然避开旧字幕,不需要额外的失效策略。
   */
  subtitles?: DramaSubtitleUrls;
}

/** 一章的互动图:起始节点 + 所有节点 + cdnBase + externalId(点赞用)+ 本章简介(meta.description)。 */
export interface ChapterGraph {
  externalId: string;
  /** 节点视频 base = 章节详情 JSON url 的目录(视频与本章 JSON 同目录);不再用 meta.cdnBase。 */
  cdnBase: string;
  startNodeId: string;
  description: string; // meta.description:剧名下副标题 + 简介弹窗展示
  nodes: DramaNode[];
}

/** 某节点的播放 url = cdnBase + '/' + node.video。 */
export function nodeVideoUrl(cdnBase: string, node: DramaNode): string {
  return joinUrl(cdnBase, node.video);
}

/** 解析节点资源 url:绝对(http/https 开头)直接用;相对则拼 cdnBase(与视频同 base)。空 → undefined。 */
function resolveNodeAsset(cdnBase: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return /^https?:\/\//i.test(path) ? path : joinUrl(cdnBase, path);
}

/**
 * 归一节点字幕:只收 zh/en 两种语言的非空字符串,路径按 cdnBase 解析成绝对 URL。
 *
 * 一条都没有时返回 undefined 而不是空对象 —— 调用方只需判断字段在不在,
 * 不用再区分"没有字段"和"有字段但是空的"。
 */
function normalizeSubtitles(
  raw: unknown,
  cdnBase: string,
): DramaSubtitleUrls | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: DramaSubtitleUrls = {};
  for (const lang of ['zh', 'en'] as const) {
    const path = typeof src[lang] === 'string' ? (src[lang] as string).trim() : '';
    if (!path) continue;
    const url = resolveNodeAsset(cdnBase, path);
    if (url) out[lang] = url;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeNode(raw: Record<string, unknown>, cdnBase: string): DramaNode | null {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const video = typeof raw?.video === 'string' ? raw.video : '';
  if (!id || !video) return null;
  const rawChoices = Array.isArray(raw?.choices) ? (raw.choices as Record<string, unknown>[]) : [];
  const choices: DramaChoice[] = rawChoices
    .map((c) => ({
      key: typeof c?.key === 'string' ? c.key : '',
      label: typeof c?.label === 'string' ? c.label : '',
      next: typeof c?.next === 'string' ? c.next : '',
    }))
    // 同 next 的自指防御:选项指向自身节点等于"选了也走不掉",直接丢弃该选项
    // (全被丢弃时该节点退化为无 choices,走末尾/连播流程,不会卡死在选择弹层)。
    .filter((c) => c.key && c.next && c.next !== id);
  // 线性后继归一为 undefined(= 无后继)的三种情况:
  //   · 缺省;
  //   · "-1" —— 发布侧的"无后继"哨兵值;
  //   · **指向自己** —— 实测多部剧的末尾节点被误写成自身 id(如 Golden Feather 第 2 集
  //     045aea5f、The Double Life 第 1 集 4a1843d6)。不归一的话播完会按 next 推进到
  //     自己,画面原地卡死;当作无后继处理后,与 "-1" 走同一套流程(有 choices/qte 就
  //     等交互,否则算本章播完 → 连播下一集)。
  const rawNext = typeof raw?.next === 'string' ? raw.next.trim() : '';
  const next = rawNext && rawNext !== '-1' && rawNext !== id ? rawNext : undefined;
  const endType: DramaEndType | undefined =
    raw?.end_type === 'death' || raw?.end_type === 'chapter' || raw?.end_type === 'game'
      ? raw.end_type
      : undefined;
  return {
    id,
    title: typeof raw?.title === 'string' ? raw.title : undefined,
    video,
    coverImage: resolveNodeAsset(cdnBase, typeof raw?.coverImage === 'string' ? raw.coverImage : undefined),
    next,
    question: typeof raw?.question === 'string' ? raw.question : undefined,
    duration: typeof raw?.duration === 'number' ? raw.duration : undefined,
    // 数字也认:哨兵 -1 后端可能按数字下发,只按 string 取会漏掉,漏掉就会照常倒计时
    // 并自动替用户选第一个选项 —— 正好是这个哨兵要禁止的行为。
    defaultChoice:
      typeof raw?.defaultChoice === 'string'
        ? raw.defaultChoice
        : typeof raw?.defaultChoice === 'number'
          ? String(raw.defaultChoice)
          : undefined,
    choices: choices.length ? choices : undefined,
    qte: normalizeQte(raw?.qte),
    // 结局字段:仅认三个约定值,未知值当普通节点(脏数据不该把播放卡死)。
    endType,
    // 文案按结局类型取各自的字段(game_desc / chapter_desc / death_desc)。
    endDesc: endType ? pickString(raw?.[`${endType}_desc`]) : undefined,
    subtitles: normalizeSubtitles(raw?.subtitles, cdnBase),
  };
}

/** 解析 qte(支持 type==='click' | 'swipe');其余类型 / 缺字段 → undefined,该节点当普通线性节点。 */
function normalizeQte(raw: unknown): DramaQte | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const q = raw as Record<string, unknown>;
  const type = q.type === 'click' || q.type === 'swipe' ? q.type : null;
  if (!type) return undefined;
  // "x,y" 字符串 → {x, y};约定 x=宽方向、y=高方向(与 area_position 一致)。
  const parsePair = (s: unknown): { x: number; y: number } => {
    const [a, b] = String(s ?? '').split(',').map((v) => parseFloat(v));
    return { x: Number.isFinite(a) ? a : 0, y: Number.isFinite(b) ? b : 0 };
  };
  const num = (v: unknown, d = 0): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : d;
  };
  const nm = (q.next_node_map && typeof q.next_node_map === 'object'
    ? (q.next_node_map as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof nm[k] === 'string' ? (nm[k] as string) : undefined);
  const dir = q.swipe_direction;
  const swipeDirection =
    dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right' ? dir : undefined;
  return {
    type,
    duration: num(q.duration),
    areaPosition: parsePair(q.area_position),
    areaSize: parsePair(q.area_size),
    swipeDirection,
    swipeAngleTolerance: type === 'swipe' ? num(q.swipe_angle_tolerance, 30) : undefined,
    swipeMinDistance: type === 'swipe' ? num(q.swipe_min_distance, 50) : undefined,
    successNext: pick('1'),
    failNext: pick('0'),
    timeoutNext: pick('2'),
  };
}
