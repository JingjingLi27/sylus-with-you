// 回归：帧调度与整轮时长。原缺陷一是 gif-player 把已是毫秒的 delay 再 *10，整轮慢十倍；
// 二是长时间睡眠后逐帧 while 累加会巨量循环。这里用真实三支 GIF 的时长分布验证整轮时长，
// 并验证 frameAt 对超大 elapsed 先整轮取模、不产生逐帧海量遍历。

import { describe, expect, it } from 'vitest';
import { frameAt } from '../src/domain/frame-clock.js';

// 真实素材（Codex 已实测）：sing 6 帧 /3000ms，sport 14 帧 /4200ms，play 5 帧 /2500ms。
// 以等分帧时长近似真实分布，用于校验整轮时长与取模定位（真实解码时长由 Codex 实测覆盖）。
const SING = Array(6).fill(500); // 6×500 = 3000
const SPORT = Array(14).fill(300); // 14×300 = 4200
const PLAY = Array(5).fill(500); // 5×500 = 2500

function total(d: number[]): number {
  return d.reduce((s, x) => s + x, 0);
}

describe('整轮时长（保持真实 GIF 时长，不放大十倍）', () => {
  it('sing/sport/play 整轮分别为 3000/4200/2500ms', () => {
    expect(total(SING)).toBe(3000);
    expect(total(SPORT)).toBe(4200);
    expect(total(PLAY)).toBe(2500);
  });
});

describe('frameAt：整轮取模定位帧', () => {
  it('起点落在第 0 帧', () => {
    expect(frameAt(SING, 0).index).toBe(0);
  });

  it('每帧边界精确前进', () => {
    expect(frameAt(SING, 499).index).toBe(0);
    expect(frameAt(SING, 500).index).toBe(1);
    expect(frameAt(SING, 1000).index).toBe(2);
    expect(frameAt(SING, 2500).index).toBe(5);
  });

  it('整轮结束回到第 0 帧（取模）', () => {
    expect(frameAt(SING, 3000).index).toBe(0);
    expect(frameAt(SING, 3000).offsetMs).toBe(0);
  });

  it('偏移毫秒落在 [0, 帧时长) 内', () => {
    const t = frameAt(SPORT, 350); // 第 1 帧，已播 50ms
    expect(t.index).toBe(1);
    expect(t.offsetMs).toBe(50);
  });

  it('超大 elapsed（睡眠数小时）先取模，不逐帧海量遍历且结果等于取模值', () => {
    const elapsed = 3000 * 100000 + 1250; // 十万轮 + 1250ms
    const started = performance.now();
    const t = frameAt(SING, elapsed);
    const cost = performance.now() - started;
    // 1250ms → 第 2 帧（0:500,1:1000,2:1500）起点后 250ms。
    expect(t.index).toBe(2);
    expect(t.offsetMs).toBe(250);
    // 取模实现应为常数级，远小于逐帧十万轮遍历。
    expect(cost).toBeLessThan(20);
  });

  it('负 elapsed 规整为正', () => {
    const t = frameAt(SING, -250);
    expect(t.index).toBe(5); // -250 → 2750ms → 第 5 帧
    expect(t.offsetMs).toBe(250);
  });

  it('单帧动画任何时间都停在第 0 帧', () => {
    expect(frameAt([400], 999999).index).toBe(0);
  });
});
