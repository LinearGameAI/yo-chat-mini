// Extracted from Yoroll main e6199716 src/subtitle/srt.ts.
/**
 * 极简 SRT 解析器。
 *
 * 只做短剧字幕需要的事:把 SRT 文本切成按开始时间排序的时间片。**不引入字幕框架** ——
 * 现在只需要 SRT + 纯文本渲染,等将来真要支持 WebVTT/ASS/复杂样式再换成熟库。
 *
 * 设计原则:**任何脏数据都不能让播放器失败**。字幕是播放增强,解析不出来就当没有字幕,
 * 绝不抛异常、绝不阻塞视频。所以这里对非法段落一律跳过而不是报错。
 */

/** 一条字幕。时间是相对**当前节点视频**的毫秒数,不是整集或整剧的全局时间。 */
export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * `00:00:01,200 --> 00:00:03,500`
 *
 * 宽松匹配:
 * - 毫秒分隔符逗号和点都认(`,200` / `.200`)—— 有些工具产出的是点;
 * - 箭头两侧空格数量不限;
 * - 行尾可能跟着位置参数(`X1:.. Y1:..`),忽略。
 */
const TIME_LINE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function toMs(h: string, m: string, s: string, ms: string): number {
  // 毫秒位数可能不足 3 位(`,5` 表示 500ms),按右侧补零对齐。
  const millis = Number(ms.padEnd(3, '0'));
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + millis;
}

/**
 * 去掉简单的行内标签(`<i>` `<b>` `{\an8}` 之类)。
 *
 * 字幕**始终当纯文本渲染,不执行任何 HTML**。首版不支持样式,直接剥掉标签留文字,
 * 比原样显示 `<i>` 字面量好。
 */
function stripTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();
}

/**
 * 解析 SRT 文本。空文件、纯空白、整体格式不对都返回空数组 —— 那是合法情况
 *(无对白节点就会下发空 SRT),调用方按"这一段没有字幕"处理即可。
 */
export function parseSrt(input: string): SubtitleCue[] {
  if (!input) return [];
  // UTF-8 BOM 会让第一个序号行匹配不上;\r\n 统一成 \n 再切块。
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  // 空行分块。允许块之间有多个空行,也允许文件末尾没有空行。
  const blocks = text.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (!lines.length) continue;

    // 时间行不一定是第 2 行:序号行可能缺失。所以找第一条能匹配时间的行。
    const timeIndex = lines.findIndex((l) => TIME_LINE.test(l));
    if (timeIndex === -1) continue; // 没有时间行的块整体跳过(非法段落)

    const m = TIME_LINE.exec(lines[timeIndex]);
    if (!m) continue;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    // 终点不晚于起点的段落是坏数据,留着会让二分查找失去单调性。
    if (!(endMs > startMs)) continue;

    const body = lines.slice(timeIndex + 1).join('\n');
    const cleaned = stripTags(body);
    if (!cleaned) continue; // 只有时间轴没有文字,等于没有这条

    cues.push({ startMs, endMs, text: cleaned });
  }

  // 按开始时间排序:findCue 的二分查找依赖这个前提,而 SRT 文件里的顺序并不保证。
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}

/**
 * 找出当前时刻应显示的字幕,没有就返回 null。
 *
 * 二分查找而不是每次从头扫:timeUpdate 每 250ms 就来一次,长片的 cue 可能上千条。
 * 找的是「最后一条 startMs <= timeMs 的 cue」,再判断它有没有结束 —— 字幕之间通常
 * 有空隙,落在空隙里就该什么都不显示。
 */
export function findCue(cues: SubtitleCue[], timeMs: number): SubtitleCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return null;
  const cue = cues[found];
  return timeMs < cue.endMs ? cue : null;
}
