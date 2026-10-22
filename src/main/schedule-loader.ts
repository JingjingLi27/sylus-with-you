// 加载九段作息配置并校验。错误配置回退到随应用附带的默认表，并记录错误。
// 配置随包只读，首版不支持用户自定义作息。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateSchedule } from '../domain/schedule.js';
import { VISUAL_ASSETS } from '../domain/assets.js';
import type { ScheduleSlot } from '../domain/types.js';

const canResolveVisual = (visualId: string): boolean =>
  Object.prototype.hasOwnProperty.call(VISUAL_ASSETS, visualId);

const here = dirname(fileURLToPath(import.meta.url));
// 构建后 dist/main/index.js 旁为 dist/config/schedule.json。
const CONFIG_PATH = join(here, '../config/schedule.json');

// 内置默认表：与 config/schedule.json 保持一致，作为最终兜底，确保永远可运行。
const DEFAULT_SLOTS: ScheduleSlot[] = [
  { activityId: 'lunch', label: '午餐', statusText: '正在吃午餐', startMinute: 0, endMinute: 120, visualId: 'eat' },
  { activityId: 'unknown', label: '？', statusText: '？', startMinute: 120, endMinute: 270, visualId: 'idle' },
  { activityId: 'home', label: '回家', statusText: '回家了', startMinute: 270, endMinute: 660, visualId: 'idle' },
  { activityId: 'sleep', label: '睡觉', statusText: '正在睡觉', startMinute: 660, endMinute: 1030, visualId: 'sleep' },
  { activityId: 'wake', label: '起床', statusText: '刚刚起床', startMinute: 1030, endMinute: 1040, visualId: 'wake' },
  { activityId: 'breakfast', label: '早餐', statusText: '正在吃早餐', startMinute: 1040, endMinute: 1200, visualId: 'eat' },
  { activityId: 'music', label: '听古典乐', statusText: '正在听古典乐', startMinute: 1200, endMinute: 1260, visualId: 'music' },
  { activityId: 'boxing', label: '拳击训练', statusText: '正在练拳', startMinute: 1260, endMinute: 1380, visualId: 'boxing' },
  { activityId: 'wash', label: '冲澡换衣服', statusText: '正在冲澡换衣服', startMinute: 1380, endMinute: 1440, visualId: 'wash' }
];

export async function loadSchedule(): Promise<{ slots: ScheduleSlot[]; usedDefault: boolean }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { slots?: unknown }).slots)) {
      throw new Error('配置缺少 slots 数组');
    }
    const slots = (parsed as { slots: ScheduleSlot[] }).slots;
    validateSchedule(slots, canResolveVisual);
    return { slots, usedDefault: false };
  } catch (err) {
    console.error('[schedule] 配置无效，回退默认表：', (err as Error).message);
    // 默认表自身也校验一次，确保内置数据正确（含 visualId 可解析）。
    validateSchedule(DEFAULT_SLOTS, canResolveVisual);
    return { slots: DEFAULT_SLOTS, usedDefault: true };
  }
}

export { DEFAULT_SLOTS };
