export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored' | 'aired' | 'suspended';
export type SegmentSource = 'live' | 'offline' | 'manual';

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  receivedAt: number;
  confirmedAt?: number;
  airedAt?: number;
  airedContent?: string;
  deferredToWindowId?: string;
  speaker: string;
  original: string;
  corrected: string;
  numberHints: string;
  source: SegmentSource;
  state: SegmentState;
  duplicateOf?: string;
  staleReason?: string;
  revision: number;
  tags: string[];
}

/** 播出窗口：每档窗口有容量封顶，装不下的片段排队顺延。 */
export interface BroadcastWindow {
  id: string;
  index: number;
  startTime: number;
  capacity: number;
}

/** 机房播出日志条目；complete 为 false 表示日志没补齐，片段先挂起。 */
export interface AiredRecord {
  segmentId: string;
  windowId: string;
  airedAt: number;
  content: string;
  complete: boolean;
}

export interface TermRule {
  id: string;
  source: string;
  replacement: string;
  speaker: string;
  enabled: boolean;
  caseSensitive: boolean;
  usageCount: number;
  createdAt: number;
}

export interface DeskModel {
  eventName: string;
  eventDate: string;
  segments: CaptionSegment[];
  rules: TermRule[];
  selectedId: string;
  connection: ConnectionState;
  simulatedDelay: number;
  fontSize: number;
  nextSequence: number;
  autoStream: boolean;
  lastMergedAt?: number;
  /** 播出排期起点（真实时间戳），窗口按此时刻对齐。 */
  scheduleStartAt: number;
  windows: BroadcastWindow[];
  broadcastLog: AiredRecord[];
  airedWindowIds: string[];
  updatedAt: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

/** 每档播出窗口的时长（毫秒）。 */
export const WINDOW_INTERVAL_MS = 30_000;
/** 每档窗口容量封顶（段数），装不下的排队顺延。 */
export const WINDOW_CAPACITY = 3;

const now = Date.now();
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';

function segment(
  id: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  return {
    id,
    sequence,
    startTime,
    receivedAt: now - (100 - sequence) * 8_000,
    confirmedAt: state === 'confirmed' ? now - (100 - sequence) * 7_000 : undefined,
    speaker,
    original,
    corrected,
    numberHints: '',
    source: 'live',
    state,
    revision: 0,
    tags: [],
  };
}

const seededSegments: CaptionSegment[] = [
  segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'),
  segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'),
  segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
  segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'pending'),
  segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'pending'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'pending'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'pending'),
];

const duplicate: CaptionSegment = {
  ...segment('seg-8', 8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'duplicate'),
  source: 'live',
  duplicateOf: 'seg-2',
  staleReason: '与第 2 段高度相似',
};

export function createInitialModel(): DeskModel {
  return {
    eventName: '新品发布会现场字幕',
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: [...seededSegments, duplicate],
    rules: [
      { id: 'term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
      { id: 'term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
      { id: 'term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
    ],
    selectedId: 'seg-4',
    connection: 'connected',
    simulatedDelay: 1.8,
    fontSize: 18,
    nextSequence: 9,
    autoStream: true,
    scheduleStartAt: now,
    windows: [],
    broadcastLog: [],
    airedWindowIds: [],
    updatedAt: now,
  };
}

export function cloneModel(model: DeskModel): DeskModel {
  return structuredClone(model);
}

/** 片段内容时刻落在第几档窗口（从 0 开始）。 */
export function windowIndexForSegment(segment: CaptionSegment, interval = WINDOW_INTERVAL_MS): number {
  return Math.max(0, Math.floor((segment.startTime * 1000) / interval));
}

/** 当前真实时间对应第几档窗口。 */
export function currentWindowIndex(model: DeskModel, now: number, interval = WINDOW_INTERVAL_MS): number {
  return Math.max(0, Math.floor((now - model.scheduleStartAt) / interval));
}

/** 取第 index 档窗口，缺失则补建（窗口按排期起点对齐）。 */
export function ensureWindow(windows: BroadcastWindow[], scheduleStartAt: number, index: number): BroadcastWindow {
  const existing = windows.find((item) => item.index === index);
  if (existing) return existing;
  const win = { id: `win-${index}`, index, startTime: scheduleStartAt + index * WINDOW_INTERVAL_MS, capacity: WINDOW_CAPACITY };
  windows.push(win);
  return win;
}

/**
 * 机房照常上屏：处理所有已到点的窗口，把窗口内片段按容量上屏并写入播出日志。
 * 容量封顶，装不下的片段顺延到下一档窗口；已上屏的片段不会被顶掉。
 * 断线时也会执行（机房不受影响），但校对侧视图不更新，等恢复后对账。
 */
export function processWindows(model: DeskModel, now: number): DeskModel {
  const scheduleStart = model.scheduleStartAt;
  if (!scheduleStart) return model;
  const interval = WINDOW_INTERVAL_MS;
  const cap = WINDOW_CAPACITY;
  const currentIdx = Math.floor((now - scheduleStart) / interval);
  if (currentIdx < 0) return model;

  const windows: BroadcastWindow[] = [];
  for (let i = 0; i <= currentIdx + 2; i += 1) {
    windows.push(model.windows.find((item) => item.index === i) ?? {
      id: `win-${i}`,
      index: i,
      startTime: scheduleStart + i * interval,
      capacity: cap,
    });
  }
  const log = [...model.broadcastLog];
  const airedWindowIds = [...model.airedWindowIds];
  const segments = model.segments.map((item) => ({ ...item }));

  for (let i = 0; i <= currentIdx; i += 1) {
    const win = windows[i];
    if (airedWindowIds.includes(win.id)) continue;
    const due = segments.filter((item) => {
      if (item.state === 'ignored' || item.state === 'aired') return false;
      const ownIdx = windowIndexForSegment(item, interval);
      return ownIdx === i || item.deferredToWindowId === win.id;
    }).sort((a, b) => a.sequence - b.sequence);

    if (due.length) {
      const toAir = due.slice(0, cap);
      const deferred = due.slice(cap);
      for (const item of toAir) {
        const content = item.state === 'confirmed' ? item.corrected : item.original;
        log.push({ segmentId: item.id, windowId: win.id, airedAt: now, content, complete: Math.random() > 0.25 });
      }
      for (const item of deferred) {
        const next = windows[i + 1] ?? ensureWindow(windows, scheduleStart, i + 1);
        item.deferredToWindowId = next.id;
        item.staleReason = `第 ${i + 1} 档窗口容量已满，顺延至第 ${i + 2} 档窗口`;
      }
    }
    airedWindowIds.push(win.id);
  }

  // 机房播出日志陆续补齐：未完成的条目有概率在后续轮次补全。
  for (const record of log) {
    if (!record.complete && Math.random() > 0.55) record.complete = true;
  }

  return { ...model, segments, windows, broadcastLog: log, airedWindowIds };
}

/**
 * 按机房播出日志更新校对侧视图：
 * - 有完整上屏记录 → 已上屏（回改不了，校对稿未及播出则标注以机房播出稿为准）；
 * - 日志没补齐 → 挂起，等机房补齐再定；
 * - 已确认但错过窗口 → 顺延到后续窗口，不顶掉已上屏内容。
 */
export function applyBroadcastLog(model: DeskModel, now: number): DeskModel {
  const interval = WINDOW_INTERVAL_MS;
  const currentIdx = currentWindowIndex(model, now, interval);
  const segments = model.segments.map((item) => ({ ...item }));

  for (const item of segments) {
    if (item.state === 'ignored') continue;
    const complete = model.broadcastLog.find((record) => record.segmentId === item.id && record.complete);
    if (complete) {
      item.state = 'aired';
      item.airedAt = complete.airedAt;
      item.airedContent = complete.content;
      item.deferredToWindowId = undefined;
      item.staleReason = item.corrected !== complete.content ? '已上屏，校对稿未及播出，内容以机房播出稿为准' : undefined;
      continue;
    }
    const incomplete = model.broadcastLog.find((record) => record.segmentId === item.id && !record.complete);
    if (incomplete) {
      item.state = 'suspended';
      item.staleReason = '机房播出日志未补齐，待日志补齐后确认';
      continue;
    }
    // 没有上屏记录：窗口已过则按是否已确认分别处理。
    const ownIdx = windowIndexForSegment(item, interval);
    const windowPassed = ownIdx < currentIdx;
    if (item.state === 'confirmed' && windowPassed && !item.deferredToWindowId) {
      const nextIdx = Math.max(ownIdx + 1, currentIdx + 1);
      item.deferredToWindowId = `win-${nextIdx}`;
      item.staleReason = `错过第 ${ownIdx + 1} 档窗口，已顺延至第 ${nextIdx + 1} 档窗口`;
    } else if (item.state === 'pending' && windowPassed && !item.deferredToWindowId) {
      item.state = 'stale';
      item.staleReason = `第 ${ownIdx + 1} 档窗口已过，未上屏`;
    }
  }
  return { ...model, segments };
}

/** 恢复连接后与机房对账：合并离线发件箱、补齐窗口、按日志更新视图并顺延错过的片段。 */
export function reconcile(model: DeskModel): { model: DeskModel; aired: number; suspended: number; deferred: number } {
  const now = Date.now();
  let next = mergeConfirmedSegments(model);
  // 离线确认的片段若因合并且延迟被标记为 stale，恢复为 confirmed 以便重新排档。
  next = {
    ...next,
    segments: next.segments.map((item) => (
      item.state === 'stale' && item.source === 'offline'
        ? { ...item, state: 'confirmed', staleReason: undefined }
        : item
    )),
  };
  next = processWindows(next, now);
  const beforeAired = next.segments.filter((item) => item.state === 'aired').length;
  next = applyBroadcastLog(next, now);
  const afterAired = next.segments.filter((item) => item.state === 'aired').length;
  return {
    model: { ...next, connection: 'connected', lastMergedAt: now, updatedAt: now },
    aired: afterAired - beforeAired,
    suspended: next.segments.filter((item) => item.state === 'suspended').length,
    deferred: next.segments.filter((item) => !!item.deferredToWindowId && item.state !== 'aired').length,
  };
}

export function normalizeNumbers(text: string): string {
  const digitMap: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };
  const chineseNumber = (raw: string): number => {
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百千万]/u.test(raw)) return Number([...raw].map((char) => digits[char] ?? 0).join(''));
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of raw) {
      if (digits[char] !== undefined) {
        number = digits[char];
      } else if (char === '十') {
        section += (number || 1) * 10;
        number = 0;
      } else if (char === '百') {
        section += (number || 1) * 100;
        number = 0;
      } else if (char === '千') {
        section += (number || 1) * 1000;
        number = 0;
      } else if (char === '万') {
        total += (section + number) * 10_000;
        section = 0;
        number = 0;
      }
    }
    return total + section + number;
  };

  return text
    .replace(/[０-９]/g, (char) => digitMap[char] ?? char)
    .replace(/([零〇一二两三四五六七八九十百千万]+)/gu, (match) => String(chineseNumber(match)))
    .replace(/(?<=\d)[，,](?=\d{3}\b)/g, ',');
}

export function normalizePunctuation(text: string): string {
  return text
    .replace(/([，。！？；：])(?=[^\s，。！？；：])/gu, '$1')
    .replace(/\s+([，。！？；：])/gu, '$1')
    .replace(/([,;:!?])(?=[^\s,;:!?])/g, (match) => ({ ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' }[match] ?? match));
}

export function applyRules(text: string, model: DeskModel): { text: string; used: string[] } {
  let next = text;
  const used: string[] = [];
  for (const rule of model.rules.filter((item) => item.enabled)) {
    if (!rule.source || !next) continue;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (expression.test(next)) {
      next = next.replace(expression, rule.replacement);
      used.push(rule.id);
    }
  }
  return { text: normalizePunctuation(next), used };
}

export function isDuplicate(candidate: CaptionSegment, existing: CaptionSegment[]): CaptionSegment | undefined {
  const normalize = (value: string) => value.replace(/[\s，。！？；：,.;:!?]/g, '').toLocaleLowerCase();
  const candidateText = normalize(candidate.corrected || candidate.original);
  return existing.find((segmentItem) => {
    if (segmentItem.id === candidate.id || segmentItem.state === 'ignored') return false;
    const text = normalize(segmentItem.corrected || segmentItem.original);
    if (!candidateText || !text) return false;
    return text === candidateText || (Math.abs(segmentItem.startTime - candidate.startTime) < 12 && (text.includes(candidateText) || candidateText.includes(text)));
  });
}

export function mergeConfirmedSegments(model: DeskModel): DeskModel {
  const seen: string[] = [];
  const segments = model.segments
    .map((item) => ({ ...item }))
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)
    .map((item): CaptionSegment => {
      if (item.source === 'offline' && item.state === 'confirmed') {
        item.source = item.confirmedAt && Date.now() - item.confirmedAt > 90_000 ? 'offline' : 'live';
        item.staleReason = Date.now() - item.receivedAt > 90_000 ? `离线恢复后合并，原始片段已延迟 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` : undefined;
        if (item.staleReason) item.state = 'stale';
      }
      const duplicate = isDuplicate(item, seen.map((id) => model.segments.find((segmentItem) => segmentItem.id === id)).filter(Boolean) as CaptionSegment[]);
      if (duplicate && item.state !== 'confirmed') {
        item.state = 'duplicate';
        item.duplicateOf = duplicate.id;
      }
      if (item.state !== 'ignored') seen.push(item.id);
      return item;
    });

  return {
    ...model,
    segments,
    connection: 'connected',
    simulatedDelay: Math.max(0.8, model.simulatedDelay - 0.7),
    lastMergedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function queueStats(model: DeskModel) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  const aired = model.segments.filter((item) => item.state === 'aired');
  const suspended = model.segments.filter((item) => item.state === 'suspended');
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline: offline.length,
    aired: aired.length,
    suspended: suspended.length,
    backlog: pending.length + stale.length + duplicate.length + offline.length + suspended.length,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

export function createLiveSegment(sequence: number): CaptionSegment {
  const speakers = ['主持人', '主讲人', '嘉宾 / 周然', '现场提问'];
  const samples = [
    '接下来请产品团队介绍新的工作流。',
    '请注意屏幕右侧的实时队列状态。',
    '在弱网环境下我们会保留未确认片段。',
    '如果网络恢复,系统会按照时间顺序自动合并。',
    '这段字幕包含二零二五年的项目数据。',
    '大家可以在会后查看完整回放和术语表。',
  ];
  const start = Math.max(0, sequence * 9 - 10);
  return {
    id: `seg-live-${sequence}-${Date.now().toString(36)}`,
    sequence,
    startTime: start,
    receivedAt: Date.now(),
    speaker: speakers[(sequence - 1) % speakers.length],
    original: samples[(sequence - 1) % samples.length],
    corrected: samples[(sequence - 1) % samples.length],
    numberHints: '',
    source: 'live',
    state: 'pending',
    revision: 0,
    tags: [],
  };
}

export function simulateLatency(model: DeskModel): DeskModel {
  const now = Date.now();
  if (model.connection === 'offline') {
    // 离线：机房照常上屏（播出日志持续累积），校对侧视图保持陈旧，等恢复后对账。
    return processWindows(model, now);
  }
  const step = model.connection === 'degraded' ? 0.7 : model.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((model.simulatedDelay + step).toFixed(1))));
  const applyStream = model.autoStream && Math.random() > 0.68;
  let nextSequence = model.nextSequence;
  let segments = model.segments;
  if (applyStream) {
    const candidate = createLiveSegment(model.nextSequence);
    const duplicate = isDuplicate(candidate, segments);
    segments = [...segments, duplicate ? { ...candidate, state: 'duplicate', duplicateOf: duplicate.id, staleReason: `与第 ${duplicate.sequence} 段重复` } : candidate];
    nextSequence += 1;
  }
  const pendingCutoff = now - 90_000;
  segments = segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((now - item.receivedAt) / 1000)} 秒` }
    : item);
  let next: DeskModel = {
    ...model,
    segments,
    nextSequence,
    simulatedDelay: delay,
    connection: delay > 4.2 ? 'degraded' : model.connection,
    updatedAt: now,
  };
  next = processWindows(next, now);
  next = applyBroadcastLog(next, now);
  return next;
}

export function toSrt(model: DeskModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  return model.segments
    .filter((item) => item.state === 'aired' || item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.startTime + 7)}\n[${item.speaker}] ${item.airedContent ?? item.corrected}\n`)
    .join('\n');
}
