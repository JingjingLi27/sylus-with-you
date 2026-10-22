// 回归：GestureHandler 的点击/拖动判定与冻结相关行为。
// 用轻量 fakeTarget 模拟 EventTarget（不引入 DOM 依赖），验证：
// - 命中才接管、非主键忽略；
// - 超阈值才算拖动并回调 onDragBegin/onDragMove，未超阈值松手为 onClick；
// - armed 期间 isArmed 为真（上层据此在 pointerleave 不松开）；
// - pointercancel / lostpointercapture 安全收尾且不触发点击；
// - cancel() 可外部强制结束。

import { describe, expect, it, vi } from 'vitest';
import { GestureHandler, type GestureCallbacks } from '../src/renderer/pet/gestures.js';

type Handler = (e: PointerEvent) => void;

class FakeTarget {
  private listeners = new Map<string, Set<Handler>>();
  captured: number | null = null;

  addEventListener(type: string, fn: Handler): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Handler): void {
    this.listeners.get(type)?.delete(fn);
  }
  setPointerCapture(id: number): void {
    this.captured = id;
  }
  releasePointerCapture(id: number): void {
    if (this.captured === id) this.captured = null;
  }
  emit(type: string, e: Partial<PointerEvent>): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e as PointerEvent);
  }
}

function evt(partial: Partial<PointerEvent>): Partial<PointerEvent> {
  return { button: 0, pointerId: 1, screenX: 0, screenY: 0, clientX: 0, clientY: 0, ...partial };
}

function makeHarness(isHit = true) {
  const target = new FakeTarget();
  const cb: GestureCallbacks = {
    isHit: vi.fn(() => isHit),
    onClick: vi.fn(),
    onDragBegin: vi.fn(),
    onDragMove: vi.fn(),
    onDragEnd: vi.fn()
  };
  const gh = new GestureHandler(target as unknown as HTMLElement, cb);
  return { target, cb, gh };
}

describe('点击判定', () => {
  it('命中后按下-松手（未移动）触发 onClick', () => {
    const { target, cb } = makeHarness();
    target.emit('pointerdown', evt({}));
    target.emit('pointerup', evt({}));
    expect(cb.onClick).toHaveBeenCalledTimes(1);
    expect(cb.onDragBegin).not.toHaveBeenCalled();
  });

  it('未命中时按下不接管手势', () => {
    const { target, cb, gh } = makeHarness(false);
    target.emit('pointerdown', evt({}));
    expect(gh.isArmed).toBe(false);
    target.emit('pointerup', evt({}));
    expect(cb.onClick).not.toHaveBeenCalled();
  });

  it('非主键忽略', () => {
    const { target, gh } = makeHarness();
    target.emit('pointerdown', evt({ button: 2 }));
    expect(gh.isArmed).toBe(false);
  });
});

describe('拖动判定', () => {
  it('超阈值才算拖动，回调 begin/move，松手 end 且不点击', () => {
    const { target, cb, gh } = makeHarness();
    target.emit('pointerdown', evt({ screenX: 0, screenY: 0 }));
    expect(gh.isArmed).toBe(true);
    // 小于阈值：不开始拖动。
    target.emit('pointermove', evt({ screenX: 2, screenY: 0 }));
    expect(cb.onDragBegin).not.toHaveBeenCalled();
    // 超阈值：开始拖动。
    target.emit('pointermove', evt({ screenX: 10, screenY: 0 }));
    expect(cb.onDragBegin).toHaveBeenCalledTimes(1);
    expect(gh.isDragging).toBe(true);
    target.emit('pointermove', evt({ screenX: 20, screenY: 0 }));
    expect(cb.onDragMove).toHaveBeenCalled();
    target.emit('pointerup', evt({ screenX: 20, screenY: 0 }));
    expect(cb.onDragEnd).toHaveBeenCalledTimes(1);
    expect(cb.onClick).not.toHaveBeenCalled();
    expect(gh.isDragging).toBe(false);
  });

  it('armed 但未超阈值时 isArmed 为真（上层据此在 pointerleave 不松开）', () => {
    const { target, gh } = makeHarness();
    target.emit('pointerdown', evt({}));
    expect(gh.isArmed).toBe(true);
    expect(gh.isDragging).toBe(false);
  });
});

describe('安全收尾', () => {
  it('pointercancel 结束拖动但不触发点击', () => {
    const { target, cb } = makeHarness();
    target.emit('pointerdown', evt({}));
    target.emit('pointermove', evt({ screenX: 10 }));
    target.emit('pointercancel', evt({}));
    expect(cb.onDragEnd).toHaveBeenCalledTimes(1);
    expect(cb.onClick).not.toHaveBeenCalled();
  });

  it('lostpointercapture 在拖动中安全收尾', () => {
    const { target, cb, gh } = makeHarness();
    target.emit('pointerdown', evt({}));
    target.emit('pointermove', evt({ screenX: 10 }));
    target.emit('lostpointercapture', evt({}));
    expect(cb.onDragEnd).toHaveBeenCalledTimes(1);
    expect(gh.isArmed).toBe(false);
    expect(gh.isDragging).toBe(false);
  });

  it('cancel() 外部强制结束，拖动中触发 onDragEnd', () => {
    const { target, cb, gh } = makeHarness();
    target.emit('pointerdown', evt({}));
    target.emit('pointermove', evt({ screenX: 10 }));
    gh.cancel();
    expect(cb.onDragEnd).toHaveBeenCalledTimes(1);
    expect(gh.isArmed).toBe(false);
    expect(target.captured).toBeNull();
  });

  it('cancel() 在仅 armed（未拖动）时不触发 onDragEnd', () => {
    const { target, cb, gh } = makeHarness();
    target.emit('pointerdown', evt({}));
    gh.cancel();
    expect(cb.onDragEnd).not.toHaveBeenCalled();
    expect(gh.isArmed).toBe(false);
  });
});

describe('整个按下期间的冻结回调',()=>{
  it('点击也必须成对调用按下与释放',()=>{
    const {target,cb,gh}=makeHarness();cb.onPress=vi.fn();cb.onRelease=vi.fn();
    target.emit('pointerdown',evt({}));expect(cb.onPress).toHaveBeenCalledTimes(1);
    expect(gh.isDragging).toBe(false);
    target.emit('pointerup',evt({}));expect(cb.onRelease).toHaveBeenCalledTimes(1);
    target.emit('lostpointercapture',evt({}));expect(cb.onRelease).toHaveBeenCalledTimes(1);
  });
  it('仅按下后取消也释放冻结，不触发点击',()=>{
    const {target,cb,gh}=makeHarness();cb.onPress=vi.fn();cb.onRelease=vi.fn();
    target.emit('pointerdown',evt({}));gh.cancel();
    expect(cb.onRelease).toHaveBeenCalledTimes(1);expect(cb.onClick).not.toHaveBeenCalled();
  });
  it('捕获失败不留下armed，也不冻结或触发点击',()=>{
    const {target,cb,gh}=makeHarness();cb.onPress=vi.fn();
    target.setPointerCapture=()=>{throw Error('capture failed');};
    target.emit('pointerdown',evt({}));target.emit('pointerup',evt({}));
    expect(gh.isArmed).toBe(false);expect(cb.onPress).not.toHaveBeenCalled();expect(cb.onClick).not.toHaveBeenCalled();
  });
});
