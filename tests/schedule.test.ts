import { describe, expect, it } from 'vitest';
import scheduleConfig from '../src/config/schedule.json';
import {
  MINUTES_PER_DAY,
  ScheduleError,
  formatClock,
  minuteOfDay,
  normalizeMinuteOfDay,
  resolveActivity,
  resolveActivityAtMinute,
  validateSchedule
} from '../src/domain/schedule.js';
import type { ScheduleSlot } from '../src/domain/types.js';

const slots = scheduleConfig.slots as ScheduleSlot[];

describe('默认作息配置', () => {
  it('精确覆盖 1440 分钟且通过校验', () => {
    expect(() => validateSchedule(slots)).not.toThrow();
    expect(slots[0].startMinute).toBe(0);
    expect(slots[slots.length - 1].endMinute).toBe(MINUTES_PER_DAY);
  });

  it('九个时段相邻无空隙无重叠', () => {
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].startMinute).toBe(slots[i - 1].endMinute);
    }
    expect(slots).toHaveLength(9);
  });

  it('每一分钟都有且只有一个活动', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m += 1) {
      const matches = slots.filter((s) => s.startMinute <= m && m < s.endMinute);
      expect(matches).toHaveLength(1);
    }
  });
});

describe('配置校验失败场景', () => {
  it('首段不从 0 开始应报错', () => {
    const bad = slots.map((s, i) => (i === 0 ? { ...s, startMinute: 1 } : s));
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('末段不到 1440 应报错', () => {
    const bad = slots.map((s, i) =>
      i === slots.length - 1 ? { ...s, endMinute: 1439 } : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('存在空隙应报错', () => {
    const bad = slots.map((s) =>
      s.activityId === 'unknown' ? { ...s, startMinute: 121 } : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('存在重叠应报错', () => {
    const bad = slots.map((s) =>
      s.activityId === 'unknown' ? { ...s, startMinute: 119 } : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('零长度时段应报错', () => {
    const bad = slots.map((s) =>
      s.activityId === 'wake' ? { ...s, endMinute: s.startMinute } : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('activityId 重复应报错', () => {
    const bad = slots.map((s) =>
      s.activityId === 'unknown' ? { ...s, activityId: 'lunch' } : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('空配置应报错', () => {
    expect(() => validateSchedule([])).toThrow(ScheduleError);
  });

  it('乱序配置被严格拒绝（避免验证通过但 next 算错）', () => {
    // 交换前两段顺序，覆盖区间仍是 0–1440 但 startMinute 非升序。
    const reordered = [slots[1], slots[0], ...slots.slice(2)];
    expect(() => validateSchedule(reordered)).toThrow(ScheduleError);
  });

  it('visualId 缺失应报错', () => {
    const bad = slots.map((s, i) =>
      i === 0 ? ({ ...s, visualId: '' } as ScheduleSlot) : s
    );
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('visualId 不可解析应报错（给定解析器时）', () => {
    const bad = slots.map((s, i) =>
      i === 0 ? { ...s, visualId: 'no-such-visual' } : s
    );
    expect(() =>
      validateSchedule(bad, (v) => v !== 'no-such-visual')
    ).toThrow(ScheduleError);
  });

  it('label/statusText 为空应报错', () => {
    const badLabel = slots.map((s, i) => (i === 0 ? { ...s, label: '' } : s));
    expect(() => validateSchedule(badLabel)).toThrow(ScheduleError);
    const badStatus = slots.map((s, i) => (i === 0 ? { ...s, statusText: '' } : s));
    expect(() => validateSchedule(badStatus)).toThrow(ScheduleError);
  });

  it('分钟超出 0–1440 应报错', () => {
    const bad = slots.map((s, i) => (i === 0 ? { ...s, startMinute: -1 } : s));
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('时段非对象应报错（损坏 JSON 结构）', () => {
    const bad = [null as unknown as ScheduleSlot, ...slots.slice(1)];
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });

  it('分钟非整数应报错', () => {
    const bad = slots.map((s, i) => (i === 0 ? { ...s, endMinute: 120.5 } : s));
    expect(() => validateSchedule(bad)).toThrow(ScheduleError);
  });
});

describe('九个边界：前 1 分钟、正点、后 1 分钟', () => {
  // [activityId, 正点分钟]
  const boundaries: Array<[string, number]> = [
    ['lunch', 0],
    ['unknown', 120],
    ['home', 270],
    ['sleep', 660],
    ['wake', 1030],
    ['breakfast', 1040],
    ['music', 1200],
    ['boxing', 1260],
    ['wash', 1380]
  ];

  for (const [activityId, start] of boundaries) {
    it(`${activityId} 在 ${start} 分正点进入`, () => {
      expect(resolveActivityAtMinute(start, slots).current.activityId).toBe(activityId);
    });

    it(`${activityId} 起点前一分钟属于上一段`, () => {
      const before = resolveActivityAtMinute((start + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY, slots);
      expect(before.current.activityId).not.toBe(activityId);
    });
  }

  it('17:10（1030）进入起床，17:09 仍睡觉，17:20（1040）进入早餐', () => {
    expect(resolveActivityAtMinute(1029, slots).current.activityId).toBe('sleep');
    expect(resolveActivityAtMinute(1030, slots).current.activityId).toBe('wake');
    expect(resolveActivityAtMinute(1039, slots).current.activityId).toBe('wake');
    expect(resolveActivityAtMinute(1040, slots).current.activityId).toBe('breakfast');
  });

  it('午夜 00:00（0）进入午餐，23:59（1439）仍在冲澡', () => {
    expect(resolveActivityAtMinute(0, slots).current.activityId).toBe('lunch');
    expect(resolveActivityAtMinute(1439, slots).current.activityId).toBe('wash');
  });

  it('23:00（1380）进入冲澡，拳击止于 22:59', () => {
    expect(resolveActivityAtMinute(1379, slots).current.activityId).toBe('boxing');
    expect(resolveActivityAtMinute(1380, slots).current.activityId).toBe('wash');
  });
});

describe('下一活动与跨午夜', () => {
  it('冲澡的下一活动是次日午餐', () => {
    const r = resolveActivityAtMinute(1400, slots);
    expect(r.next.activityId).toBe('lunch');
    expect(r.nextIsTomorrow).toBe(true);
    expect(r.nextStartMinute).toBe(0);
  });

  it('午餐的下一活动是当天 ？，非次日', () => {
    const r = resolveActivityAtMinute(10, slots);
    expect(r.next.activityId).toBe('unknown');
    expect(r.nextIsTomorrow).toBe(false);
    expect(r.nextStartMinute).toBe(120);
  });
});

describe('墙上时间解析', () => {
  it('按本地小时分钟解析，不依赖运行时长', () => {
    const d = new Date(2026, 9, 5, 20, 30, 0); // 20:30 → music
    expect(minuteOfDay(d)).toBe(1230);
    expect(resolveActivity(d, slots).current.activityId).toBe('music');
  });
});

describe('分钟归一化与时钟格式化', () => {
  it('负数与超限按天取模', () => {
    expect(normalizeMinuteOfDay(-1)).toBe(1439);
    expect(normalizeMinuteOfDay(1440)).toBe(0);
    expect(normalizeMinuteOfDay(1441)).toBe(1);
  });

  it('格式化为 24 小时钟表', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(1260)).toBe('21:00');
    expect(formatClock(1030)).toBe('17:10');
  });
});
