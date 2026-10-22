// 回归：PetController 的状态与异步编排。覆盖原漏修的真实缺陷——
// A 加载晚到不盖 B、加载中隐藏不启动、隐藏切 A→B 恢复 B、手势冻结期间快照/异步不换帧而释放显示最新、
// 同一 visualId 不同活动标签刷新、预览标识增删且占位覆盖。
// 用可控 deferred promise 与轻量 fake 依赖驱动实际 controller（非未接入的假模型）。

import { describe, expect, it, vi } from 'vitest';
import { PetController, type ControllerDeps } from '../src/renderer/pet/pet-controller.js';
import type { LoadedAnimation } from '../src/renderer/pet/gif-player.js';
import type { VisualAsset } from '../src/domain/assets.js';
import type { RuntimeSnapshot, ScheduleSlot } from '../src/domain/types.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeAnimation(id: string): LoadedAnimation {
  return {
    frames: [{ bitmap: { id } as unknown as ImageData, durationMs: 100 }],
    width: 512,
    height: 512,
    totalDurationMs: 100
  };
}

const ASSETS: Record<string, VisualAsset> = {
  music: {
    visualId: 'music',
    label: '听古典乐',
    reviewStatus: 'real',
    kind: 'gif',
    file: 'gifs/sing.gif',
    sourceId: null,
    placeholderBaseFile: null,
    note: ''
  },
  boxing: {
    visualId: 'boxing',
    label: '拳击训练',
    reviewStatus: 'candidate',
    kind: 'gif',
    file: 'gifs/sport.gif',
    sourceId: null,
    placeholderBaseFile: null,
    note: ''
  },
  idle: {
    visualId: 'idle',
    label: '待机',
    reviewStatus: 'candidate',
    kind: 'gif',
    file: 'gifs/play.gif',
    sourceId: null,
    placeholderBaseFile: null,
    note: ''
  },
  eat: {
    visualId: 'eat',
    label: '进食',
    reviewStatus: 'placeholder',
    kind: 'generated',
    file: null,
    sourceId: null,
    placeholderBaseFile: 'gifs/play.gif',
    note: ''
  }
};

function slot(visualId: string, label: string): ScheduleSlot {
  return {
    activityId: label,
    label,
    statusText: label,
    startMinute: 0,
    endMinute: 60,
    visualId
  };
}

function snapshot(partial: {
  revision: number;
  visualId: string;
  label: string;
  hidden?: boolean;
  reducedMotion?: boolean;
  mode?: 'realtime' | 'preview';
}): RuntimeSnapshot {
  const s = slot(partial.visualId, partial.label);
  return {
    revision: partial.revision,
    mode: partial.mode ?? 'realtime',
    previewMinute: partial.mode === 'preview' ? 0 : null,
    realActivityId: partial.label,
    displayedActivityId: partial.label,
    displayedSlot: s,
    nextSlot: s,
    nextIsTomorrow: false,
    nextStartMinute: 60,
    hidden: partial.hidden ?? false,
    reducedMotion: partial.reducedMotion ?? false
  };
}

// 共享视觉：idle 与 eat 由多活动共用（需活动标签区分）。
const SHARED = new Set(['idle', 'eat']);

function makeHarness(opts?: {
  loadAnimation?: ControllerDeps['loadAnimation'];
  loadPlaceholderBase?: ControllerDeps['loadPlaceholderBase'];
}) {
  const deps = {
    resolveAsset: vi.fn((id: string) => ASSETS[id]),
    loadAnimation:
      opts?.loadAnimation ?? vi.fn((file: string) => Promise.resolve(fakeAnimation(file))),
    loadPlaceholderBase: opts?.loadPlaceholderBase ?? vi.fn(() => Promise.resolve(null)),
    isSharedVisual: vi.fn((id: string) => SHARED.has(id)),
    startLoop: vi.fn(),
    stopLoop: vi.fn(),
    paintPlaceholder: vi.fn(),
    repaintOverlays: vi.fn(),
    recheckHit: vi.fn(),
    cancelGesture: vi.fn()
  } satisfies ControllerDeps;
  const controller = new PetController(deps);
  return { controller, deps };
}

describe('加载竞争：A 加载晚到不覆盖 B', () => {
  it('A 加载中切 B，A 晚到被丢弃，画面停在 B', async () => {
    const dA = deferred<LoadedAnimation>();
    const dB = deferred<LoadedAnimation>();
    const loadAnimation = vi.fn((file: string) =>
      file === 'gifs/sing.gif' ? dA.promise : dB.promise
    );
    const { controller, deps } = makeHarness({ loadAnimation });

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    controller.onSnapshot(snapshot({ revision: 2, visualId: 'boxing', label: '拳击训练' }));

    dB.resolve(fakeAnimation('B'));
    await Promise.resolve();
    await Promise.resolve();
    dA.resolve(fakeAnimation('A'));
    await Promise.resolve();
    await Promise.resolve();

    const started = deps.startLoop.mock.calls.map((c) => (c[0] as LoadedAnimation).frames[0].bitmap);
    // 只应启动 B；A 晚到被 token 作废。
    expect(started).toContainEqual({ id: 'B' } as unknown as ImageData);
    expect(started).not.toContainEqual({ id: 'A' } as unknown as ImageData);
    // 最后一次启动的是 B。
    const last = deps.startLoop.mock.calls.at(-1)![0] as LoadedAnimation;
    expect(last.frames[0].bitmap).toEqual({ id: 'B' });
  });
});

describe('加载中隐藏不启动', () => {
  it('加载进行中收到隐藏，晚到素材不启动循环', async () => {
    const d = deferred<LoadedAnimation>();
    const loadAnimation = vi.fn(() => d.promise);
    const { controller, deps } = makeHarness({ loadAnimation });

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    controller.onSnapshot(
      snapshot({ revision: 2, visualId: 'music', label: '听古典乐', hidden: true })
    );
    d.resolve(fakeAnimation('music'));
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.startLoop).not.toHaveBeenCalled();
    expect(deps.stopLoop).toHaveBeenCalled();
  });
});

describe('隐藏切 A→B 后恢复 B', () => {
  it('隐藏期间切换到 B，恢复时加载并启动 B 而非旧 A', async () => {
    const { controller, deps } = makeHarness();

    // 显示 A 并加载完成。
    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();
    deps.startLoop.mockClear();

    // 隐藏。
    controller.onSnapshot(
      snapshot({ revision: 2, visualId: 'music', label: '听古典乐', hidden: true })
    );
    // 隐藏期间目标切到 B（主进程照常推进）。
    controller.onSnapshot(
      snapshot({ revision: 3, visualId: 'boxing', label: '拳击训练', hidden: true })
    );
    // 恢复。
    controller.onSnapshot(snapshot({ revision: 4, visualId: 'boxing', label: '拳击训练' }));
    await Promise.resolve();
    await Promise.resolve();

    const last = deps.startLoop.mock.calls.at(-1)![0] as LoadedAnimation;
    expect(last.frames[0].bitmap).toEqual({ id: 'gifs/sport.gif' });
  });

  it('隐藏后恢复到相同视觉：直接重启已加载动画，不重新加载', async () => {
    const loadAnimation = vi.fn((file: string) => Promise.resolve(fakeAnimation(file)));
    const { controller, deps } = makeHarness({ loadAnimation });

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();
    const loadsBefore = loadAnimation.mock.calls.length;
    deps.startLoop.mockClear();

    controller.onSnapshot(
      snapshot({ revision: 2, visualId: 'music', label: '听古典乐', hidden: true })
    );
    controller.onSnapshot(snapshot({ revision: 3, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();

    expect(loadAnimation.mock.calls.length).toBe(loadsBefore); // 未重新加载。
    expect(deps.startLoop).toHaveBeenCalledTimes(1); // 直接重启。
  });
});

describe('手势冻结：期间快照/异步不换帧，释放显示最新', () => {
  it('冻结期间收到快照只缓存不换帧，释放后应用最新目标', async () => {
    const { controller, deps } = makeHarness();

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();

    controller.freeze();
    deps.startLoop.mockClear();
    deps.paintPlaceholder.mockClear();

    // 冻结期间推进目标：不应换帧。
    controller.onSnapshot(snapshot({ revision: 2, visualId: 'boxing', label: '拳击训练' }));
    await Promise.resolve();
    expect(deps.startLoop).not.toHaveBeenCalled();

    // 释放：应用缓存的最新目标 boxing。
    controller.release();
    await Promise.resolve();
    await Promise.resolve();
    const last = deps.startLoop.mock.calls.at(-1)![0] as LoadedAnimation;
    expect(last.frames[0].bitmap).toEqual({ id: 'gifs/sport.gif' });
  });

  it('冻结期间异步加载晚到被作废，不覆盖冻结画面', async () => {
    const d = deferred<LoadedAnimation>();
    const loadAnimation = vi.fn(() => d.promise);
    const { controller, deps } = makeHarness({ loadAnimation });

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    controller.freeze();
    // 冻结后 music 的加载才完成。
    d.resolve(fakeAnimation('music'));
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.startLoop).not.toHaveBeenCalled();
  });

  it('释放时无新快照：恢复当前已加载动画', async () => {
    const { controller, deps } = makeHarness();
    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();

    controller.freeze();
    deps.startLoop.mockClear();
    controller.release();

    expect(deps.startLoop).toHaveBeenCalledTimes(1); // 恢复当前动画。
    expect(deps.recheckHit).toHaveBeenCalled();
  });

  it('隐藏优先取消手势，不被 pending 拖住', async () => {
    const { controller, deps } = makeHarness();
    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    controller.freeze();
    controller.onSnapshot(snapshot({ revision: 2, visualId: 'boxing', label: '拳击训练' })); // 仅缓存

    controller.onSnapshot(
      snapshot({ revision: 3, visualId: 'boxing', label: '拳击训练', hidden: true })
    );

    expect(deps.cancelGesture).toHaveBeenCalled();
    expect(deps.stopLoop).toHaveBeenCalled();
  });
});

describe('同一 visualId 不同活动：标签刷新', () => {
  it('共享真实 GIF（idle→回家/？）切活动时重绘叠加标签', async () => {
    const { controller, deps } = makeHarness();

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'idle', label: '回家' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.activeOverlayLabel).toBe('回家');
    deps.repaintOverlays.mockClear();

    controller.onSnapshot(snapshot({ revision: 2, visualId: 'idle', label: '？' }));
    await Promise.resolve();

    expect(deps.repaintOverlays).toHaveBeenCalled();
    expect(controller.activeOverlayLabel).toBe('？');
  });

  it('占位（eat→午餐/早餐）切活动时按新标签重绘占位', async () => {
    const { controller, deps } = makeHarness();

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'eat', label: '午餐' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.paintPlaceholder).toHaveBeenLastCalledWith('eat', '午餐', null);

    controller.onSnapshot(snapshot({ revision: 2, visualId: 'eat', label: '早餐' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.paintPlaceholder).toHaveBeenLastCalledWith('eat', '早餐', null);
  });

  it('独有真实 GIF 无可见标签叠加', async () => {
    const { controller } = makeHarness();
    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.activeOverlayLabel).toBeNull();
  });
});

describe('预览标识增删与占位覆盖', () => {
  it('开启/关闭预览触发叠加层重绘，previewMode 可增可删', async () => {
    const { controller, deps } = makeHarness();

    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.previewMode).toBe(false);
    deps.repaintOverlays.mockClear();

    controller.onSnapshot(
      snapshot({ revision: 2, visualId: 'music', label: '听古典乐', mode: 'preview' })
    );
    expect(controller.previewMode).toBe(true);
    expect(deps.repaintOverlays).toHaveBeenCalled();

    deps.repaintOverlays.mockClear();
    controller.onSnapshot(
      snapshot({ revision: 3, visualId: 'music', label: '听古典乐', mode: 'realtime' })
    );
    expect(controller.previewMode).toBe(false);
    expect(deps.repaintOverlays).toHaveBeenCalled();
  });

  it('占位视觉：预览标识不计入占位的角色绘制（占位用 paintPlaceholder，叠加用 repaintOverlays）', async () => {
    const { controller, deps } = makeHarness();
    controller.onSnapshot(
      snapshot({ revision: 1, visualId: 'eat', label: '午餐', mode: 'preview' })
    );
    await Promise.resolve();
    await Promise.resolve();
    // 占位基础帧只含干净角色与活动标签，预览标识通过独立叠加层叠加。
    expect(deps.paintPlaceholder).toHaveBeenCalledWith('eat', '午餐', null);
    expect(deps.repaintOverlays).toHaveBeenCalled();
    expect(controller.previewMode).toBe(true);
  });
});

describe('过期 revision 丢弃', () => {
  it('较旧 revision 不处理', async () => {
    const { controller, deps } = makeHarness();
    controller.onSnapshot(snapshot({ revision: 5, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    deps.startLoop.mockClear();
    controller.onSnapshot(snapshot({ revision: 3, visualId: 'boxing', label: '拳击训练' }));
    await Promise.resolve();
    expect(deps.startLoop).not.toHaveBeenCalled();
  });
});

describe('真实 GIF 加载失败回退占位', () => {
  it('加载 reject 时回退占位帧', async () => {
    const loadAnimation = vi.fn(() => Promise.reject(new Error('fail')));
    const { controller, deps } = makeHarness({ loadAnimation });
    controller.onSnapshot(snapshot({ revision: 1, visualId: 'music', label: '听古典乐' }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.paintPlaceholder).toHaveBeenCalledWith('music', '听古典乐', null);
  });
});

describe('松手后的目标一致性回归', () => {
  it('冻结期间收到相同目标快照，松手仍恢复动画', async () => {
    const {controller,deps}=makeHarness();
    controller.onSnapshot(snapshot({revision:1,visualId:'music',label:'听古典乐'}));
    await Promise.resolve();
    controller.freeze(); deps.startLoop.mockClear();
    controller.onSnapshot(snapshot({revision:2,visualId:'music',label:'听古典乐'}));
    controller.release();
    expect(deps.startLoop).toHaveBeenCalledTimes(1);
  });
  it('手势中断新目标加载，松手重试新目标而不是播放旧动画', async () => {
    const loads: Array<{file:string; done:ReturnType<typeof deferred<LoadedAnimation>>}>=[];
    const {controller,deps}=makeHarness({loadAnimation:file=>{const done=deferred<LoadedAnimation>();loads.push({file,done});return done.promise;}});
    controller.onSnapshot(snapshot({revision:1,visualId:'music',label:'听古典乐'}));
    loads[0].done.resolve(fakeAnimation('music'));await Promise.resolve();
    controller.onSnapshot(snapshot({revision:2,visualId:'boxing',label:'拳击训练'}));
    controller.freeze();loads[1].done.resolve(fakeAnimation('stale'));await Promise.resolve();
    deps.startLoop.mockClear();controller.release();
    expect(deps.startLoop).not.toHaveBeenCalled();
    expect(loads[2].file).toBe('gifs/sport.gif');
    loads[2].done.resolve(fakeAnimation('boxing'));await Promise.resolve();
    expect(deps.startLoop.mock.calls[0][0].frames[0].bitmap).toEqual({id:'boxing'});
  });
  it('同视觉加载期间换活动，异步完成后使用最新标签', async()=>{
    const done=deferred<ImageData|null>();
    const {controller,deps}=makeHarness({loadPlaceholderBase:()=>done.promise});
    controller.onSnapshot(snapshot({revision:1,visualId:'eat',label:'午餐'}));
    controller.onSnapshot(snapshot({revision:2,visualId:'eat',label:'早餐',mode:'preview'}));
    done.resolve(null);await Promise.resolve();
    expect(deps.paintPlaceholder).toHaveBeenLastCalledWith('eat','早餐',null);
    expect(controller.previewMode).toBe(true);
  });
  it('隐藏取消手势的回调不得重启动画', async()=>{
    const {controller,deps}=makeHarness();
    controller.onSnapshot(snapshot({revision:1,visualId:'music',label:'听古典乐'}));await Promise.resolve();
    controller.freeze();deps.startLoop.mockClear();
    deps.cancelGesture.mockImplementation(()=>controller.release());
    controller.onSnapshot(snapshot({revision:2,visualId:'music',label:'听古典乐',hidden:true}));
    expect(deps.startLoop).not.toHaveBeenCalled();
  });
});
