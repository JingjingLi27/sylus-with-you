// 模式与状态规则：纯函数，描述真实时间 / 预览 / 隐藏之间如何组合成一个快照。
// 不触碰窗口、文件或计时器；主进程用它计算要广播的 RuntimeSnapshot。

import { formatClock, resolveActivity, resolveActivityAtMinute } from './schedule.js';
import type { DisplayMode, RuntimeSnapshot, ScheduleSlot } from './types.js';

/** 协调器维护的内部状态，不直接发给渲染进程。 */
export type CoordinatorState = {
  mode: DisplayMode;
  /** 预览分钟（0–1439）；realtime 时为 null。 */
  previewMinute: number | null;
  hidden: boolean;
  reducedMotion: boolean;
};

export const INITIAL_COORDINATOR_STATE: CoordinatorState = {
  mode: 'realtime',
  previewMinute: null,
  hidden: false,
  reducedMotion: false
};

/**
 * 依据当前内部状态与墙上时间，计算一份完整快照。
 * revision 由调用方递增传入，保证渲染进程能丢弃过期更新。
 *
 * 关键规则：
 * - 真实活动始终来自墙上时间，预览只临时替换展示活动。
 * - 预览时 displayedActivityId 为预览活动，realActivityId 仍为真实活动。
 * - 下一活动、下一分界始终基于“当前展示的时间”计算，使气泡与画面一致。
 */
export function buildSnapshot(
  state: CoordinatorState,
  now: Date,
  slots: ScheduleSlot[],
  revision: number
): RuntimeSnapshot {
  const real = resolveActivity(now, slots);

  if (state.mode === 'preview' && state.previewMinute !== null) {
    const preview = resolveActivityAtMinute(state.previewMinute, slots);
    return {
      revision,
      mode: 'preview',
      displaySecond: state.previewMinute * 60,
      previewMinute: state.previewMinute,
      realActivityId: real.current.activityId,
      displayedActivityId: preview.current.activityId,
      displayedSlot: preview.current,
      nextSlot: preview.next,
      nextIsTomorrow: preview.nextIsTomorrow,
      nextStartMinute: preview.nextStartMinute,
      hidden: state.hidden,
      reducedMotion: state.reducedMotion
    };
  }

  return {
    revision,
    mode: 'realtime',
    displaySecond: now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds(),
    previewMinute: null,
    realActivityId: real.current.activityId,
    displayedActivityId: real.current.activityId,
    displayedSlot: real.current,
    nextSlot: real.next,
    nextIsTomorrow: real.nextIsTomorrow,
    nextStartMinute: real.nextStartMinute,
    hidden: state.hidden,
    reducedMotion: state.reducedMotion
  };
}

/**
 * 判断两份快照在“展示相关字段”上是否一致。
 * 用于主进程只有在展示数据变化时才通知界面，避免每秒写盘或重载图片。
 * revision 不参与比较。
 */
export function snapshotDisplayEqual(a: RuntimeSnapshot, b: RuntimeSnapshot): boolean {
  return (
    a.mode === b.mode &&
    a.displaySecond === b.displaySecond &&
    a.previewMinute === b.previewMinute &&
    a.displayedActivityId === b.displayedActivityId &&
    // 预览期间真实时间仍在走动，realActivityId 变化需触发更新，使设置窗“真实时间为…”刷新。
    a.realActivityId === b.realActivityId &&
    a.nextSlot.activityId === b.nextSlot.activityId &&
    a.nextIsTomorrow === b.nextIsTomorrow &&
    a.nextStartMinute === b.nextStartMinute &&
    a.hidden === b.hidden &&
    a.reducedMotion === b.reducedMotion
  );
}

/**
 * 生成状态气泡文字，例如：
 *   "正在听古典乐 · 21:00 开始练拳"
 *   "正在冲澡换衣服 · 明天 00:00 吃午餐"
 * 预览模式下在前面加“[预览] ”标识。首版不做秒级倒计时。
 */
export function buildBubbleText(snapshot: RuntimeSnapshot): string {
  const current = snapshot.displayedSlot.statusText;
  const clock = formatClock(snapshot.nextStartMinute);
  const when = snapshot.nextIsTomorrow ? `明天 ${clock}` : clock;
  const nextLabel = snapshot.nextSlot.label;
  const nextLine = `${when} ${nextActivityVerb(nextLabel)}`;
  const base = `${current} · ${nextLine}`;
  return snapshot.mode === 'preview' ? `[预览] ${base}` : base;
}

/**
 * 把下一活动名称转成“开始…/去…”式短语。
 * 保持克制：无法确定动词的活动直接用“进入”。
 */
function nextActivityVerb(label: string): string {
  switch (label) {
    case '午餐':
      return '吃午餐';
    case '早餐':
      return '吃早餐';
    case '睡觉':
      return '睡觉';
    case '起床':
      return '起床';
    case '听古典乐':
      return '听古典乐';
    case '拳击训练':
      return '练拳';
    case '冲澡换衣服':
      return '冲澡换衣服';
    case '回家':
      return '回家';
    case '？':
      return '进入 ？';
    default:
      return `进入${label}`;
  }
}
