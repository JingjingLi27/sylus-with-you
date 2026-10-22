import { describe, expect, it, vi } from 'vitest';
import scheduleConfig from '../src/config/schedule.json';
import { StateCoordinator } from '../src/main/coordinator.js';
import type { ScheduleSlot } from '../src/domain/types.js';

const slots = scheduleConfig.slots as ScheduleSlot[];

// 可控时钟：测试通过改变返回值模拟墙上时间推进，不触碰系统时钟。
function clockAt(ref: { d: Date }) {
  return () => ref.d;
}

describe('协调器：实时与预览', () => {
  it('启动立即给出正确实时活动', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) }; // music
    const c = new StateCoordinator(slots, clockAt(ref));
    expect(c.getSnapshot().displayedActivityId).toBe('music');
    expect(c.getSnapshot().mode).toBe('realtime');
  });

  it('进入预览只改展示活动，真实活动不变', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    c.setPreviewMinute(700); // sleep
    const s = c.getSnapshot();
    expect(s.displayedActivityId).toBe('sleep');
    expect(s.realActivityId).toBe('music');
    expect(s.mode).toBe('preview');
  });

  it('退出预览立即回到真实时间', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    c.setPreviewMinute(700);
    c.clearPreview();
    const s = c.getSnapshot();
    expect(s.mode).toBe('realtime');
    expect(s.displayedActivityId).toBe('music');
  });

  it('非法预览分钟被忽略，不进入预览', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    c.setPreviewMinute(5000);
    expect(c.getSnapshot().mode).toBe('realtime');
    c.setPreviewMinute(12.5);
    expect(c.getSnapshot().mode).toBe('realtime');
  });
});

describe('协调器：revision 与广播', () => {
  it('展示数据不变时不递增 revision、不重复广播', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    const seen: number[] = [];
    c.subscribe((s) => seen.push(s.revision));
    const r1 = c.getSnapshot().revision;
    c.recompute(); // 同一分钟，展示未变
    c.recompute();
    expect(c.getSnapshot().revision).toBe(r1);
    // 订阅只在初始收到一次。
    expect(seen).toHaveLength(1);
  });

  it('跨越边界后 revision 递增并广播', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 59) }; // music
    const c = new StateCoordinator(slots, clockAt(ref));
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.displayedActivityId));
    ref.d = new Date(2026, 9, 5, 21, 0); // boxing
    c.recompute();
    expect(c.getSnapshot().displayedActivityId).toBe('boxing');
    expect(seen).toEqual(['music', 'boxing']);
  });

  it('唤醒后跨多段直接显示当前活动，不补播', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) }; // music
    const c = new StateCoordinator(slots, clockAt(ref));
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.displayedActivityId));
    // 模拟睡眠：时间直接跳到次日 00:30（lunch），中间不 recompute。
    ref.d = new Date(2026, 9, 6, 0, 30);
    c.recompute();
    expect(c.getSnapshot().displayedActivityId).toBe('lunch');
    // 中间的 boxing/wash 不补播。
    expect(seen).toEqual(['music', 'lunch']);
  });
});

describe('协调器：隐藏与减少动态效果', () => {
  it('隐藏状态变更会广播', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    const seen: boolean[] = [];
    c.subscribe((s) => seen.push(s.hidden));
    c.setHidden(true);
    expect(c.getSnapshot().hidden).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('重复设置相同隐藏值不重复广播', () => {
    const ref = { d: new Date(2026, 9, 5, 20, 30) };
    const c = new StateCoordinator(slots, clockAt(ref));
    const spy = vi.fn();
    c.subscribe(spy);
    c.setHidden(false); // 与初始相同
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
