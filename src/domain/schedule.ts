// 纯作息计算：不创建窗口、不读取图片、不依赖 Electron。时间由外部注入，便于测试边界。

import type { ActivityResolution, ScheduleSlot } from './types.js';

export const MINUTES_PER_DAY = 1440;

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * 校验作息配置是否精确覆盖 1440 分钟：
 * - 每个时段是对象，字段类型正确；activityId / label / statusText 为非空字符串；
 * - visualId 非空且（给定解析器时）可解析；
 * - startMinute / endMinute 为 0–1440 的整数，长度大于 0；
 * - 必须已按 startMinute 升序排列（乱序直接拒绝，避免验证通过但下一活动算错）；
 * - 首段从 0 开始、末段到 1440 结束、相邻无空隙无重叠、活动 ID 唯一。
 * 不通过时抛出 ScheduleError，由调用方决定是否回退默认表。
 *
 * @param canResolveVisual 可选：返回 visualId 是否可解析为素材；缺省不校验可解析性。
 */
export function validateSchedule(
  slots: ScheduleSlot[],
  canResolveVisual?: (visualId: string) => boolean
): void {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new ScheduleError('作息配置为空');
  }

  const ids = new Set<string>();
  for (const slot of slots) {
    if (typeof slot !== 'object' || slot === null) {
      throw new ScheduleError('时段必须是对象');
    }
    for (const field of ['activityId', 'label', 'statusText'] as const) {
      if (typeof slot[field] !== 'string' || slot[field].length === 0) {
        throw new ScheduleError(`时段缺少非空字符串字段 ${field}`);
      }
    }
    if (ids.has(slot.activityId)) {
      throw new ScheduleError(`activityId 重复：${slot.activityId}`);
    }
    ids.add(slot.activityId);

    if (!Number.isInteger(slot.startMinute) || !Number.isInteger(slot.endMinute)) {
      throw new ScheduleError(`时段 ${slot.activityId} 的分钟必须是整数`);
    }
    if (
      slot.startMinute < 0 ||
      slot.startMinute > MINUTES_PER_DAY ||
      slot.endMinute < 0 ||
      slot.endMinute > MINUTES_PER_DAY
    ) {
      throw new ScheduleError(`时段 ${slot.activityId} 的分钟必须在 0–1440 之间`);
    }
    if (slot.endMinute <= slot.startMinute) {
      throw new ScheduleError(`时段 ${slot.activityId} 长度必须大于 0`);
    }
    if (typeof slot.visualId !== 'string' || slot.visualId.length === 0) {
      throw new ScheduleError(`时段 ${slot.activityId} 缺少 visualId`);
    }
    if (canResolveVisual && !canResolveVisual(slot.visualId)) {
      throw new ScheduleError(`时段 ${slot.activityId} 的 visualId 无法解析：${slot.visualId}`);
    }
  }

  // 必须已按 startMinute 升序；运行期 resolveActivityAtMinute 依赖原顺序取 next。
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].startMinute <= slots[i - 1].startMinute) {
      throw new ScheduleError('时段必须按 startMinute 升序排列，不接受乱序配置');
    }
  }

  if (slots[0].startMinute !== 0) {
    throw new ScheduleError('首段必须从 0 分钟开始');
  }
  if (slots[slots.length - 1].endMinute !== MINUTES_PER_DAY) {
    throw new ScheduleError('末段必须到 1440 分钟结束');
  }
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].startMinute !== slots[i - 1].endMinute) {
      throw new ScheduleError(
        `时段 ${slots[i - 1].activityId} 与 ${slots[i].activityId} 之间存在空隙或重叠`
      );
    }
  }
}

/**
 * 把一天中的分钟数（0–1439）归一化到有效范围。
 * 负数或超过一天的输入按天取模，保证始终落入某个时段。
 */
export function normalizeMinuteOfDay(minute: number): number {
  const m = Math.floor(minute) % MINUTES_PER_DAY;
  return m < 0 ? m + MINUTES_PER_DAY : m;
}

/**
 * 从墙上时间取当天分钟数。读取的是当前本地钟表，不按运行时长累计。
 */
export function minuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * 解析某一分钟所属活动，并给出下一活动。
 * slots 需已通过 validateSchedule；此处假设覆盖完整，找不到视为编程错误。
 */
export function resolveActivityAtMinute(
  minute: number,
  slots: ScheduleSlot[]
): ActivityResolution {
  const m = normalizeMinuteOfDay(minute);
  const index = slots.findIndex((slot) => slot.startMinute <= m && m < slot.endMinute);
  if (index < 0) {
    throw new ScheduleError(`分钟 ${m} 未落入任何时段，配置可能未覆盖 1440 分钟`);
  }
  const nextIndex = (index + 1) % slots.length;
  const nextSlot = slots[nextIndex];
  return {
    current: slots[index],
    next: nextSlot,
    nextIsTomorrow: index === slots.length - 1,
    nextStartMinute: nextSlot.startMinute
  };
}

/** 便捷重载：直接按墙上时间解析。 */
export function resolveActivity(now: Date, slots: ScheduleSlot[]): ActivityResolution {
  return resolveActivityAtMinute(minuteOfDay(now), slots);
}

/** 把当天分钟数格式化为 24 小时钟表文字，例如 1260 → "21:00"。 */
export function formatClock(minute: number): string {
  const m = normalizeMinuteOfDay(minute);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
