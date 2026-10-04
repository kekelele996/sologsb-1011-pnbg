export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored' | 'suspended' | 'aired';
export type SegmentSource = 'live' | 'offline' | 'manual';
export type AirStatus = 'aired' | 'suspended';
export type CorrectionStatus = 'queued' | 'scheduled' | 'suspended' | 'delivered';
export type ScheduleKind = 'delivery' | 'correction';

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  receivedAt: number;
  confirmedAt?: number;
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
  /** 已上屏的文本；存在即表示机房侧已经播出，本地不可再回改，只能发追改。 */
  airedText?: string;
}

/** 机房播出日志：只持有“已上屏字幕 + 播出时刻”这一半。 */
export interface MachineRoomEntry {
  id: string;
  segmentId: string;
  windowId: string;
  /** 实际播出时刻（相对开播的秒数）。 */
  airedAt: number;
  airedText: string;
  /** 该段日志是否已补齐；未补齐前校对台只能挂起等待。 */
  logComplete: boolean;
  note?: string;
}

/** 错过播出窗口的改动，只能作为“追改”排入后面的窗口。 */
export interface CorrectionJob {
  id: string;
  segmentId: string;
  text: string;
  status: CorrectionStatus;
  createdAt: number;
  /** 挂起原因（机房日志未补齐等）。 */
  holdReason?: string;
  scheduledWindowId?: string;
  deliveredAt?: number;
}

/** 一档播出窗口：容量封顶，已上屏槽位永远不会被顶掉。 */
export interface BroadcastWindow {
  id: string;
  index: number;
  /** 相对开播的起止秒数。 */
  start: number;
  end: number;
  capacity: number;
  /** 计划槽位：d:<segmentId> 正常投递，c:<correctionId> 追改。 */
  scheduledIds: string[];
}

export interface ScheduleItem {
  kind: ScheduleKind;
  segmentId: string;
  id: string;
  sequence: number;
  text: string;
  /** 段落原始开始时刻（秒），用于决定投递的首选窗口；追改传 Infinity。 */
  sequenceStart: number;
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
  updatedAt: number;
  windows: BroadcastWindow[];
  machineEntries: MachineRoomEntry[];
  corrections: CorrectionJob[];
  playhead: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

const now = Date.now();
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v2';

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
    confirmedAt: state === 'aired' ? now - (100 - sequence) * 7_000 : undefined,
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
  // seg-1~3：机房已经上屏，日志齐全（两边对账一致）。
  { ...segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'aired'), airedText: '欢迎大家来到2026年产品发布会。' },
  { ...segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'aired'), airedText: '今天我们会介绍三个模块,首先是实时协作。' },
  { ...segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'aired'), airedText: '延迟和质量监测会帮助我们保持字幕稳定。' },
  // seg-4：机房已上屏旧稿，日志缺失 → 先挂起；本地已改好 Studio Cloud。
  segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'suspended'),
  // seg-5~7：机房日志也未补齐，且各带着本地改动 → 挂起；其中 seg-7 会演示窗口装不下顺延。
  segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'suspended'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'suspended'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'suspended'),
];

const duplicate: CaptionSegment = {
  ...segment('seg-8', 8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'duplicate'),
  source: 'live',
  duplicateOf: 'seg-2',
  staleReason: '与第 2 段高度相似',
};

const seededWindows: BroadcastWindow[] = [
  { id: 'win-1', index: 1, start: 0, end: 30, capacity: 4, scheduledIds: ['d:seg-1', 'd:seg-2', 'd:seg-3', 'd:seg-4'] },
  { id: 'win-2', index: 2, start: 30, end: 60, capacity: 3, scheduledIds: [] },
  { id: 'win-3', index: 3, start: 60, end: 90, capacity: 2, scheduledIds: [] },
  { id: 'win-4', index: 4, start: 90, end: 120, capacity: 3, scheduledIds: [] },
  { id: 'win-5', index: 5, start: 120, end: 150, capacity: 3, scheduledIds: [] },
];

const seededMachineEntries: MachineRoomEntry[] = [
  { id: 'air-1', segmentId: 'seg-1', windowId: 'win-1', airedAt: 1, airedText: '欢迎大家来到2026年产品发布会。', logComplete: true },
  { id: 'air-2', segmentId: 'seg-2', windowId: 'win-1', airedAt: 8, airedText: '今天我们会介绍三个模块,首先是实时协作。', logComplete: true },
  { id: 'air-3', segmentId: 'seg-3', windowId: 'win-1', airedAt: 16, airedText: '延迟和质量监测会帮助我们保持字幕稳定。', logComplete: true },
  { id: 'air-4', segmentId: 'seg-4', windowId: 'win-1', airedAt: 25, airedText: '我们使用 studio cloud 作为演示环境。', logComplete: true },
];

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
    connection: 'offline',
    simulatedDelay: 1.8,
    fontSize: 18,
    nextSequence: 9,
    autoStream: true,
    updatedAt: now,
    windows: seededWindows.map((item) => ({ ...item, scheduledIds: [...item.scheduledIds] })),
    machineEntries: seededMachineEntries.map((item) => ({ ...item })),
    corrections: [],
    playhead: 28,
  };
}

export function cloneModel(model: DeskModel): DeskModel {
  return structuredClone(model);
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

// ---------------------------------------------------------------------------
// 机房对账：校对台持有草稿，机房持有已上屏字幕和播出时刻，断网恢复后两边对账。
// ---------------------------------------------------------------------------

const DELIVERY_PREFIX = 'd:';
const CORRECTION_PREFIX = 'c:';

export const deliverySlotId = (segmentId: string) => `${DELIVERY_PREFIX}${segmentId}`;
export const correctionSlotId = (correctionId: string) => `${CORRECTION_PREFIX}${correctionId}`;

export function parseSlot(slotId: string): { kind: ScheduleKind; refId: string } {
  return slotId.startsWith(CORRECTION_PREFIX)
    ? { kind: 'correction', refId: slotId.slice(CORRECTION_PREFIX.length) }
    : { kind: 'delivery', refId: slotId.slice(DELIVERY_PREFIX.length) };
}

export function findEntry(model: DeskModel, segmentId: string): MachineRoomEntry | undefined {
  return model.machineEntries.find((item) => item.segmentId === segmentId);
}

export function findCorrection(model: DeskModel, segmentId: string): CorrectionJob | undefined {
  return model.corrections.find((item) => item.segmentId === segmentId && item.status !== 'delivered');
}

/**
 * 把“正常投递 + 追改”按序号顺序装进窗口。
 * - 已上屏（窗口已结束）的槽位永不挪动；只往仍开着（window.end > playhead）的窗口塞。
 * - 追改只能排进其原段落上屏窗口之后的窗口。
 * - 每档窗口容量封顶，装不下的排队顺延到后面窗口。
 */
export function packSchedule(model: DeskModel, deliveries: ScheduleItem[], corrections: ScheduleItem[]): {
  windows: BroadcastWindow[];
  deliveryById: Map<string, string>;
  correctionById: Map<string, string>;
  overflow: number;
} {
  const windows = model.windows
    .sort((a, b) => a.index - b.index)
    .map((window) => ({ ...window, scheduledIds: [...window.scheduledIds] }));
  const completeEntryBySegment = new Map(
    model.machineEntries.filter((item) => item.logComplete).map((item) => [item.segmentId, item]),
  );

  const fits = (window: BroadcastWindow) => window.scheduledIds.length < window.capacity && window.end > model.playhead;

  const place = (slotId: string, minIndex: number): string | undefined => {
    for (const window of windows.slice(Math.max(0, minIndex))) {
      if (!fits(window)) continue;
      window.scheduledIds.push(slotId);
      return window.id;
    }
    return undefined;
  };

  const deliveryById = new Map<string, string>();
  const correctionById = new Map<string, string>();

  for (const item of deliveries.sort((a, b) => a.sequence - b.sequence || a.sequenceStart - b.sequenceStart)) {
    // 正常投递：首选段落开始时刻所属且仍开着的窗口；该档已过或已满则顺延到后面的窗口。
    const naturalIndex = windows.findIndex((window) => window.start <= item.sequenceStart && item.sequenceStart < window.end);
    const minIndex = naturalIndex >= 0 && windows[naturalIndex].end > model.playhead ? naturalIndex : naturalIndex + 1;
    const windowId = place(deliverySlotId(item.segmentId), Math.max(0, minIndex));
    if (windowId) deliveryById.set(item.segmentId, windowId);
  }

  for (const item of corrections.sort((a, b) => a.sequence - b.sequence)) {
    const airedAt = completeEntryBySegment.get(item.segmentId)?.airedAt;
    const airedIndex = airedAt === undefined ? -1 : windows.findIndex((window) => airedAt >= window.start && airedAt < window.end);
    // 追改只能进上屏窗口之后的窗口。
    const windowId = place(correctionSlotId(item.id), airedIndex >= 0 ? airedIndex + 1 : 0);
    if (windowId) correctionById.set(item.id, windowId);
  }

  const scheduledCount = deliveryById.size + correctionById.size;
  const overflow = deliveries.length + corrections.length - scheduledCount;
  return { windows, deliveryById, correctionById, overflow: Math.max(0, overflow) };
}

/** 清理窗口里所有非锁定槽位（未到期的投递/追改），已上屏的槽位原样保留。 */
function unlockableSlots(model: DeskModel): Set<string> {
  const locked = new Set<string>();
  for (const entry of model.machineEntries) {
    if (entry.logComplete) locked.add(deliverySlotId(entry.segmentId));
  }
  return locked;
}

function resetOpenSchedule(model: DeskModel): BroadcastWindow[] {
  const locked = unlockableSlots(model);
  return model.windows
    .sort((a, b) => a.index - b.index)
    .map((window) => ({ ...window, scheduledIds: window.scheduledIds.filter((slotId) => locked.has(slotId) || window.end <= model.playhead) }));
}

function deliveryItem(segment: CaptionSegment): ScheduleItem {
  return { kind: 'delivery', id: deliverySlotId(segment.id), segmentId: segment.id, sequence: segment.sequence, text: segment.corrected, sequenceStart: segment.startTime };
}

function correctionItem(correction: CorrectionJob, sequence: number): ScheduleItem {
  return { kind: 'correction', id: correction.id, segmentId: correction.segmentId, sequence, text: correction.text, sequenceStart: Number.POSITIVE_INFINITY };
}

export interface ReconcileReport {
  aired: number;
  correctionCreated: number;
  correctionScheduled: number;
  suspended: number;
  deliveriesScheduled: number;
  overflow: number;
}

/**
 * 断网恢复后与机房对账：
 * 1. 机房已上屏且日志齐全的段落锁定；本地旧稿改为 aired，本地新改动变成“追改”。
 * 2. 机房日志没补齐的先挂起（suspended），等机房补齐再定。
 * 3. 离线期间确认、但机房没有上屏记录的段落正常投递，过期内容保留过期提示。
 * 4. 全部投递/追改按序号排入仍开着的窗口，容量封顶、装不下顺延。
 */
export function reconcileWithMachineRoom(model: DeskModel): { model: DeskModel; report: ReconcileReport } {
  const working = cloneModel(model);
  const segmentById = new Map(working.segments.map((item) => [item.id, item]));
  let aired = 0;
  let correctionCreated = 0;
  let suspended = 0;
  const staleNow = Date.now();

  // 1. 逐条对齐机房日志。
  for (const entry of working.machineEntries) {
    const segment = segmentById.get(entry.segmentId);
    if (!segment) continue;
    if (!entry.logComplete) {
      // 理论上未补齐的日志不会出现在列表里；防御性处理为挂起。
      if (segment.state !== 'aired') segment.state = 'suspended';
      continue;
    }
    const localText = segment.corrected.trim();
    const airedText = entry.airedText.trim();
    segment.airedText = entry.airedText;
    segment.state = 'aired';
    if (!segment.corrected || segment.corrected === segment.original) segment.corrected = entry.airedText;
    aired += 1;

    // 本地改好的内容错过了这档窗口：已上屏的回改不了，排追改。
    if (localText && localText !== airedText) {
      const existing = working.corrections.find((item) => item.segmentId === segment.id);
      if (!existing) {
        working.corrections.push({
          id: `corr-${segment.id}-${staleNow.toString(36)}`,
          segmentId: segment.id,
          text: localText,
          status: 'queued',
          createdAt: staleNow,
        });
        correctionCreated += 1;
      } else if (existing.status === 'suspended') {
        existing.status = 'queued';
        existing.text = localText;
        existing.holdReason = undefined;
      }
    }
  }

  // 2. 本地有改动/已确认、但机房播出日志还没补齐的段落：先挂起。
  const pendingDeliveries: CaptionSegment[] = [];
  for (const segment of working.segments) {
    if (segment.state === 'ignored' || segment.state === 'duplicate') continue;
    const entry = working.machineEntries.find((item) => item.segmentId === segment.id);
    if (entry?.logComplete) continue;
    if (segment.state === 'aired') continue;
    const locallyConfirmed = segment.state === 'confirmed' || segment.source === 'offline';
    const locallyEdited = segment.corrected.trim() !== segment.original.trim();
    if (locallyConfirmed) {
      // 离线期间确认、机房无记录：正常投递（过期的保留提示）。
      segment.state = 'confirmed';
      if (segment.source === 'offline' && staleNow - (segment.confirmedAt ?? staleNow) > 90_000) {
        segment.staleReason = `离线恢复后合并，确认内容已延迟 ${Math.round((staleNow - (segment.confirmedAt ?? staleNow)) / 1000)} 秒`;
      }
      pendingDeliveries.push(segment);
    } else if (locallyEdited || segment.state === 'suspended') {
      segment.state = 'suspended';
      segment.staleReason ??= '机房播出日志未补齐，先挂起等待';
      suspended += 1;
    }
  }

  // 3. 把正常投递与追改装进后续窗口。先释放所有非锁定槽位，保证对账可重复执行。
  working.windows = resetOpenSchedule(working);
  // 机房日志齐全的段落，其投递槽位在对应窗口锁定；历史上屏不受容量封顶限制。
  const segmentSequence = (segmentId: string) => segmentById.get(segmentId)?.sequence ?? Number.MAX_SAFE_INTEGER;
  for (const window of working.windows) {
    const missing = working.machineEntries
      .filter((entry) => entry.logComplete && entry.windowId === window.id && !window.scheduledIds.includes(deliverySlotId(entry.segmentId)))
      .sort((a, b) => segmentSequence(a.segmentId) - segmentSequence(b.segmentId));
    if (missing.length) window.scheduledIds.unshift(...missing.map((entry) => deliverySlotId(entry.segmentId)));
  }
  for (const job of working.corrections) {
    if (job.status === 'scheduled') {
      job.status = 'queued';
      job.scheduledWindowId = undefined;
    }
  }
  const correctionItems = working.corrections
    .filter((item) => item.status === 'queued')
    .map((item) => ({
      job: item,
      item: correctionItem(item, segmentById.get(item.segmentId)?.sequence ?? Number.MAX_SAFE_INTEGER),
    }));

  const result = packSchedule(
    working,
    pendingDeliveries.map(deliveryItem),
    correctionItems.map((entry) => entry.item),
  );

  for (const [segmentId, windowId] of result.deliveryById) {
    const segment = segmentById.get(segmentId);
    if (segment) {
      segment.state = 'confirmed';
      segment.tags = [...new Set([...segment.tags, `排入 ${result.windows.find((window) => window.id === windowId)?.index ?? ''} 档窗口`])];
    }
  }
  for (const [correctionId, windowId] of result.correctionById) {
    const job = working.corrections.find((item) => item.id === correctionId);
    if (job) {
      job.status = 'scheduled';
      job.scheduledWindowId = windowId;
      job.holdReason = undefined;
    }
  }
  // 没排进任何窗口的投递/追改保持排队（queued），等后面窗口或机房日志。
  for (const { job } of correctionItems) {
    if (!result.correctionById.has(job.id)) {
      job.status = 'queued';
      job.scheduledWindowId = undefined;
    }
  }

  working.windows = result.windows;
  working.connection = 'connected';
  working.simulatedDelay = Math.max(0.8, working.simulatedDelay - 0.7);
  working.lastMergedAt = staleNow;
  working.updatedAt = staleNow;

  return {
    model: working,
    report: {
      aired,
      correctionCreated,
      correctionScheduled: result.correctionById.size,
      suspended,
      deliveriesScheduled: result.deliveryById.size,
      overflow: result.overflow,
    },
  };
}

/** 机房补齐缺失的播出日志后调用：登记日志并重新对账。 */
export function completeMachineRoomLog(model: DeskModel, segmentIds: string[]): DeskModel {
  const working = cloneModel(model);
  for (const segmentId of segmentIds) {
    const segment = working.segments.find((item) => item.id === segmentId);
    if (!segment) continue;
    const existing = working.machineEntries.find((item) => item.segmentId === segmentId);
    const window = working.windows.find((item) => item.start <= segment.startTime && segment.startTime < item.end) ?? working.windows[0];
    if (existing) {
      existing.logComplete = true;
      existing.airedText ??= segment.original;
      existing.airedAt ??= segment.startTime;
      existing.windowId ??= window.id;
      existing.note = '机房补报日志';
    } else {
      working.machineEntries.push({
        id: `air-${segmentId}-${Date.now().toString(36)}`,
        segmentId,
        windowId: window.id,
        airedAt: segment.startTime,
        airedText: segment.original,
        logComplete: true,
        note: '机房补报日志',
      });
    }
    if (segment.state === 'suspended') {
      segment.staleReason = '机房日志已补齐，等待与机房对账';
    }
  }
  return reconcileWithMachineRoom(working).model;
}

/** 对一条已上屏字幕手工登记追改（校对员在看到锁定段落后补发）。 */
export function queueCorrection(model: DeskModel, segmentId: string, text: string): DeskModel {
  const working = cloneModel(model);
  const segment = working.segments.find((item) => item.id === segmentId);
  if (!segment || !segment.airedText || text.trim() === segment.airedText.trim()) return model;
  const existing = working.corrections.find((item) => item.segmentId === segmentId && item.status !== 'delivered');
  if (existing) {
    existing.text = text;
    if (existing.status === 'suspended') {
      existing.status = 'queued';
      existing.holdReason = undefined;
    }
  } else {
    working.corrections.push({
      id: `corr-${segmentId}-${Date.now().toString(36)}`,
      segmentId,
      text,
      status: 'queued',
      createdAt: Date.now(),
    });
  }
  working.updatedAt = Date.now();
  return working;
}

/** 把已排队（还没排进窗口）的追改重新尝试装入窗口。 */
export function repackQueuedCorrections(model: DeskModel): DeskModel {
  const queued = model.corrections.filter((item) => item.status === 'queued' || item.status === 'scheduled');
  if (!queued.length) return model;
  const segmentById = new Map(model.segments.map((item) => [item.id, item]));
  const working = cloneModel(model);
  // 只释放仍开着窗口里的追改槽位；已结束窗口的历史槽位原样保留。
  working.windows = working.windows.map((window) => ({
    ...window,
    scheduledIds: window.end <= model.playhead
      ? window.scheduledIds
      : window.scheduledIds.filter((slotId) => !slotId.startsWith(CORRECTION_PREFIX)),
  }));
  for (const job of working.corrections) {
    if (job.status === 'scheduled') {
      job.status = 'queued';
      job.scheduledWindowId = undefined;
    }
  }
  const result = packSchedule(
    working,
    [],
    queued.map((job) => correctionItem(job, segmentById.get(job.segmentId)?.sequence ?? Number.MAX_SAFE_INTEGER)),
  );
  for (const [correctionId, windowId] of result.correctionById) {
    const job = working.corrections.find((item) => item.id === correctionId);
    if (job) {
      job.status = 'scheduled';
      job.scheduledWindowId = windowId;
    }
  }
  working.windows = result.windows;
  working.updatedAt = Date.now();
  return working;
}

export function queueStats(model: DeskModel) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const suspended = model.segments.filter((item) => item.state === 'suspended');
  const aired = model.segments.filter((item) => item.state === 'aired');
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  const correctionQueued = model.corrections.filter((item) => item.status === 'queued').length;
  const correctionScheduled = model.corrections.filter((item) => item.status === 'scheduled').length;
  const correctionSuspended = model.corrections.filter((item) => item.status === 'suspended').length;
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    suspended: suspended.length,
    aired: aired.length,
    offline: offline.length,
    correctionQueued,
    correctionScheduled,
    correctionSuspended,
    backlog: pending.length + stale.length + duplicate.length + suspended.length + offline.length + correctionQueued + correctionSuspended,
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

/** 播放头推进：已排入已结束窗口的槽位自动上屏，已上屏槽位永不回退。 */
function autoAireScheduled(model: DeskModel): DeskModel {
  const windows = model.windows;
  const dueDeliveries = new Set<string>();
  const dueCorrections = new Set<string>();
  for (const window of windows) {
    if (model.playhead < window.end) continue;
    for (const slotId of window.scheduledIds) {
      const slot = parseSlot(slotId);
      if (slot.kind === 'delivery') {
        const segment = model.segments.find((item) => item.id === slot.refId);
        if (segment && segment.state !== 'aired') dueDeliveries.add(slot.refId);
      } else {
        const job = model.corrections.find((item) => item.id === slot.refId);
        if (job && job.status === 'scheduled') dueCorrections.add(job.id);
      }
    }
  }
  if (!dueDeliveries.size && !dueCorrections.size) return model;

  const segments = model.segments.map((segment) => {
    if (!dueDeliveries.has(segment.id)) return segment;
    return {
      ...segment,
      state: 'aired' as SegmentState,
      airedText: segment.corrected,
      confirmedAt: segment.confirmedAt ?? Date.now(),
      tags: [...new Set([...segment.tags, '窗口到期自动上屏'])],
    };
  });
  const entries = [...model.machineEntries];
  for (const segmentId of dueDeliveries) {
    const segment = segments.find((item) => item.id === segmentId);
    const window = windows.find((item) => item.scheduledIds.includes(deliverySlotId(segmentId)));
    if (!segment || !window || entries.some((entry) => entry.segmentId === segmentId)) continue;
    entries.push({
      id: `air-${segmentId}-${Date.now().toString(36)}`,
      segmentId,
      windowId: window.id,
      airedAt: Math.min(model.playhead, window.end - 1),
      airedText: segment.corrected,
      logComplete: true,
      note: '窗口到期自动上屏',
    });
  }
  const corrections = model.corrections.map((job) => dueCorrections.has(job.id)
    ? { ...job, status: 'delivered' as CorrectionStatus, deliveredAt: Date.now() }
    : job);

  return { ...model, segments, machineEntries: entries, corrections, updatedAt: Date.now() };
}

/** 演示用：手动推进播放头，到期窗口里的槽位自动上屏。 */
export function advancePlayheadModel(model: DeskModel, seconds: number): DeskModel {
  return autoAireScheduled({ ...model, playhead: model.playhead + seconds, updatedAt: Date.now() });
}

export function simulateLatency(model: DeskModel): DeskModel {
  if (model.connection === 'offline') return model;
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
  const pendingCutoff = Date.now() - 90_000;
  segments = segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
    : item);
  let next: DeskModel = {
    ...model,
    segments,
    nextSequence,
    simulatedDelay: delay,
    connection: delay > 4.2 ? 'degraded' : model.connection,
    playhead: model.playhead + 2,
    updatedAt: Date.now(),
  };
  next = autoAireScheduled(next);
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
    .filter((item) => item.state === 'confirmed' || item.state === 'aired')
    .sort((a, b) => a.startTime - b.startTime)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.startTime + 7)}\n[${item.speaker}] ${item.airedText ?? item.corrected}\n`)
    .join('\n');
}
