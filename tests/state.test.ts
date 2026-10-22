import { describe, expect, it } from 'vitest';
import scheduleConfig from '../src/config/schedule.json';
import {
  INITIAL_COORDINATOR_STATE,
  buildBubbleText,
  buildSnapshot,
  snapshotDisplayEqual,
  type CoordinatorState
} from '../src/domain/state.js';
import type { ScheduleSlot } from '../src/domain/types.js';

const slots = scheduleConfig.slots as ScheduleSlot[];

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 5, hour, minute, 0);
}

describe('实时快照', () => {
  it('真实活动与展示活动一致', () => {
    const snap = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 1);
    expect(snap.mode).toBe('realtime');
    expect(snap.realActivityId).toBe('music');
    expect(snap.displayedActivityId).toBe('music');
    expect(snap.previewMinute).toBeNull();
    expect(snap.nextSlot.activityId).toBe('boxing');
  });
});

describe('预览快照', () => {
  const previewState: CoordinatorState = {
    mode: 'preview',
    previewMinute: 700, // 11:40 → sleep
    hidden: false,
    reducedMotion: false
  };

  it('展示活动为预览活动，真实活动仍为墙上时间活动', () => {
    const snap = buildSnapshot(previewState, at(20, 30), slots, 2);
    expect(snap.mode).toBe('preview');
    expect(snap.displayedActivityId).toBe('sleep');
    expect(snap.realActivityId).toBe('music');
    expect(snap.previewMinute).toBe(700);
  });

  it('下一活动基于预览时间计算', () => {
    const snap = buildSnapshot(previewState, at(20, 30), slots, 3);
    expect(snap.nextSlot.activityId).toBe('wake');
    expect(snap.nextStartMinute).toBe(1030);
  });

  it('退出预览后立即回到真实时间', () => {
    const snap = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 4);
    expect(snap.mode).toBe('realtime');
    expect(snap.displayedActivityId).toBe('music');
  });
});

describe('快照展示相等判断（避免每秒刷新）', () => {
  it('同一分钟内不同 revision 视为展示相等', () => {
    const a = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 1);
    const b = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 2);
    expect(snapshotDisplayEqual(a, b)).toBe(true);
  });

  it('跨越边界后视为展示不同', () => {
    const a = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 59), slots, 1);
    const b = buildSnapshot(INITIAL_COORDINATOR_STATE, at(21, 0), slots, 2);
    expect(snapshotDisplayEqual(a, b)).toBe(false);
  });

  it('隐藏状态变化视为展示不同', () => {
    const a = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 1);
    const b = buildSnapshot(
      { ...INITIAL_COORDINATOR_STATE, hidden: true },
      at(20, 30),
      slots,
      2
    );
    expect(snapshotDisplayEqual(a, b)).toBe(false);
  });

  it('预览期间真实时间跨段：realActivityId 变化视为展示不同（刷新“真实时间为…”）', () => {
    const preview: CoordinatorState = {
      mode: 'preview',
      previewMinute: 700, // 固定预览 sleep
      hidden: false,
      reducedMotion: false
    };
    // 展示活动都为预览 sleep，但真实墙上时间从 music(20:59) 跨到 boxing(21:00)。
    const a = buildSnapshot(preview, at(20, 59), slots, 1);
    const b = buildSnapshot(preview, at(21, 0), slots, 2);
    expect(a.displayedActivityId).toBe('sleep');
    expect(b.displayedActivityId).toBe('sleep');
    expect(a.realActivityId).toBe('music');
    expect(b.realActivityId).toBe('boxing');
    expect(snapshotDisplayEqual(a, b)).toBe(false);
  });
});

describe('已确认素材：各时段使用独立动画与正确标签', () => {
  it('早餐与午餐使用22和21', () => {
    const breakfast = buildSnapshot(INITIAL_COORDINATOR_STATE, at(17, 30), slots, 1); // 1050 → breakfast
    const lunch = buildSnapshot(INITIAL_COORDINATOR_STATE, at(0, 30), slots, 2); // 30 → lunch
    expect(breakfast.displayedSlot.visualId).toBe('a22');
    expect(lunch.displayedSlot.visualId).toBe('a21');
    expect(breakfast.displayedSlot.label).toBe('早餐');
    expect(lunch.displayedSlot.label).toBe('午餐');
    // 视觉相同但展示活动不同，必须视为展示不同以触发标签更新。
    expect(snapshotDisplayEqual(breakfast, lunch)).toBe(false);
  });

  it('回家与问号具有不同的起始素材', () => {
    const home = buildSnapshot(INITIAL_COORDINATOR_STATE, at(6, 0), slots, 1); // 360 → home
    const unknown = buildSnapshot(INITIAL_COORDINATOR_STATE, at(3, 0), slots, 2); // 180 → unknown
    expect(home.displayedSlot.visualId).toBe('a16');
    expect(unknown.displayedSlot.visualId).toBe('a05');
    expect(home.displayedSlot.label).toBe('回家');
    expect(unknown.displayedSlot.label).toBe('？');
    expect(snapshotDisplayEqual(home, unknown)).toBe(false);
  });
});

describe('气泡文字', () => {
  it('实时模式显示当前与下一活动', () => {
    const snap = buildSnapshot(INITIAL_COORDINATOR_STATE, at(20, 30), slots, 1);
    expect(buildBubbleText(snap)).toBe('正在听古典乐 · 21:00 练拳');
  });

  it('冲澡时下一活动为明天午餐', () => {
    const snap = buildSnapshot(INITIAL_COORDINATOR_STATE, at(23, 30), slots, 1);
    expect(buildBubbleText(snap)).toBe('正在冲澡换衣服 · 明天 00:00 吃午餐');
  });

  it('预览模式带 [预览] 标识', () => {
    const snap = buildSnapshot(
      { mode: 'preview', previewMinute: 700, hidden: false, reducedMotion: false },
      at(20, 30),
      slots,
      1
    );
    expect(buildBubbleText(snap)).toContain('[预览]');
    expect(buildBubbleText(snap)).toContain('正在睡觉');
  });
});
