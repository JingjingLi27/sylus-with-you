// 回归：命中坐标换算。原缺陷是把 CSS/DIP 的 offsetX/Y 直接当作 512 画布像素，
// 在非 512 尺寸窗口（96/160/240）上点击角色无反应。这里验证纯换算函数在多尺寸下正确。

import { describe, expect, it } from 'vitest';
import { clientToCanvas, type RectLike } from '../src/renderer/pet/coords.js';

const CANVAS = 512;

function rect(left: number, top: number, size: number): RectLike {
  return { left, top, width: size, height: size };
}

describe('clientToCanvas：多尺寸窗口坐标映射到 512 画布', () => {
  for (const size of [96, 160, 240]) {
    it(`${size} 尺寸：中心 client 映射到画布中心`, () => {
      const r = rect(0, 0, size);
      const p = clientToCanvas(size / 2, size / 2, r, CANVAS);
      expect(p.x).toBeCloseTo(CANVAS / 2, 5);
      expect(p.y).toBeCloseTo(CANVAS / 2, 5);
    });

    it(`${size} 尺寸：左上角与右下角映射到画布 0 与 512`, () => {
      const r = rect(0, 0, size);
      const tl = clientToCanvas(0, 0, r, CANVAS);
      expect(tl.x).toBe(0);
      expect(tl.y).toBe(0);
      const br = clientToCanvas(size, size, r, CANVAS);
      expect(br.x).toBeCloseTo(CANVAS, 5);
      expect(br.y).toBeCloseTo(CANVAS, 5);
    });

    it(`${size} 尺寸：窗口有偏移时按 rect.left/top 平移`, () => {
      const r = rect(100, 50, size);
      // client 落在窗口中心（100+size/2, 50+size/2）→ 画布中心。
      const p = clientToCanvas(100 + size / 2, 50 + size / 2, r, CANVAS);
      expect(p.x).toBeCloseTo(CANVAS / 2, 5);
      expect(p.y).toBeCloseTo(CANVAS / 2, 5);
    });

    it(`${size} 尺寸：四分之一处线性映射到 128`, () => {
      const r = rect(0, 0, size);
      const p = clientToCanvas(size / 4, size / 4, r, CANVAS);
      expect(p.x).toBeCloseTo(CANVAS / 4, 5);
      expect(p.y).toBeCloseTo(CANVAS / 4, 5);
    });
  }

  it('未布局（宽高为 0）返回无效坐标 -1,-1', () => {
    const p = clientToCanvas(10, 10, rect(0, 0, 0), CANVAS);
    expect(p).toEqual({ x: -1, y: -1 });
  });
});
