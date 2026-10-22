// 主进程生命周期回归测试：单实例锁、系统挂起/锁屏与用户隐藏独立、
// 挂起与锁屏重叠时不提前恢复、崩溃重建清理气泡。
// electron 与各协作模块以存根 mock；通过捕获 powerMonitor / app 的处理器驱动。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 可控的 electron 存根状态。
const ele = vi.hoisted(() => {
  const appHandlers: Record<string, Function[]> = {};
  const powerHandlers: Record<string, Function[]> = {};
  const screenHandlers: Record<string, Function[]> = {};
  return {
    gotLock: true,
    quit: vi.fn(),
    exit: vi.fn(),
    whenReadyResolvers: [] as Array<(v?: unknown) => void>,
    appHandlers,
    powerHandlers,
    screenHandlers,
    emitPower(ev: string) {
      for (const cb of powerHandlers[ev] ?? []) cb();
    },
    emitApp(ev: string, ...args: unknown[]) {
      for (const cb of appHandlers[ev] ?? []) cb(...args);
    }
  };
});

// 协作模块存根：记录调用，暴露实例给断言。
const stubs = vi.hoisted(() => {
  const coordinator = {
    start: vi.fn(),
    stop: vi.fn(),
    recompute: vi.fn(),
    getSnapshot: vi.fn(() => ({ revision: 1, displayedActivityId: 'x', hidden: false })),
    setReducedMotion: vi.fn(),
    setHidden: vi.fn(),
    isPreviewing: vi.fn(() => false),
    subscribe: vi.fn(),
    clearPreview: vi.fn()
  };
  const windows = {
    createPetWindow: vi.fn(),
    hidePet: vi.fn(),
    showPet: vi.fn(),
    setSystemSuspended: vi.fn(),
    isEffectivelyHidden: vi.fn(() => false),
    dismissBubble: vi.fn(),
    destroyPet: vi.fn(),
    getPet: vi.fn(() => null),
    getSettings: vi.fn(() => null),
    currentAnchor: vi.fn(() => null),
    setOnSettingsClosed: vi.fn(),
    setOnPetGone: vi.fn(),
    moveToPrimary: vi.fn(),
    endDrag: vi.fn(() => null),
    markBubbleReady: vi.fn(),
    handleDisplaysChanged: vi.fn(() => null),
    showBubble: vi.fn(),
    createOrShowSettings: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setCharacterHeight: vi.fn()
  };
  const settingsState = { hidden: false };
  const settings = {
    load: vi.fn(async () => {}),
    get: vi.fn(() => ({ ...settingsState, characterHeight: 160, reducedMotion: false, alwaysOnTop: true, anchorX: null, anchorY: null, displayId: null, schemaVersion: 1 })),
    update: vi.fn((p: any) => { Object.assign(settingsState, p); return settings.get(); }),
    flush: vi.fn(async () => {})
  };
  return { coordinator, windows, settings, settingsState };
});

vi.mock('electron', () => {
  const app = {
    requestSingleInstanceLock: () => ele.gotLock,
    quit: ele.quit,
    exit: ele.exit,
    setPath: () => {},
    getPath: () => '/tmp/qinche-test',
    whenReady: () =>
      new Promise((resolve) => {
        ele.whenReadyResolvers.push(resolve);
      }),
    on: (ev: string, cb: Function) => {
      (ele.appHandlers[ev] ??= []).push(cb);
    }
  };
  const powerMonitor = {
    on: (ev: string, cb: Function) => {
      (ele.powerHandlers[ev] ??= []).push(cb);
    }
  };
  const screen = {
    on: (ev: string, cb: Function) => {
      (ele.screenHandlers[ev] ??= []).push(cb);
    }
  };
  const nativeImage = { createEmpty: () => ({}) };
  class Tray {
    setTitle() {}
    setToolTip() {}
    setContextMenu() {}
  }
  const Menu = { buildFromTemplate: () => ({ popup() {} }) };
  return { app, Menu, Tray, nativeImage, powerMonitor, screen };
});

vi.mock('../src/main/coordinator.js', () => ({
  StateCoordinator: function () {
    return stubs.coordinator;
  }
}));
vi.mock('../src/main/windows.js', () => ({
  WindowManager: function () {
    return stubs.windows;
  }
}));
vi.mock('../src/main/settings.js', () => ({
  SettingsStore: function () {
    return stubs.settings;
  }
}));
vi.mock('../src/main/schedule-loader.js', () => ({
  loadSchedule: vi.fn(async () => ({ slots: [], usedDefault: false }))
}));
vi.mock('../src/main/ipc.js', () => ({
  registerIpc: vi.fn(() => () => {})
}));
vi.mock('../src/main/assets-protocol.js', () => ({
  ASSET_SCHEME: 'qinche-asset',
  registerAssetProtocol: vi.fn(),
  registerAssetSchemePrivileges: vi.fn()
}));
vi.mock('../src/domain/state.js', () => ({ buildBubbleText: () => '' }));
vi.mock('../src/domain/assets.js', () => ({ allPosesHaveRealArt: () => true }));

// 从 setOnPetGone 的调用参数读取崩溃回调（比 mockImplementation 更稳健）。
function petGoneCb(): (() => void) | null {
  const call = stubs.windows.setOnPetGone.mock.calls.at(-1);
  return (call?.[0] as (() => void)) ?? null;
}

async function bootstrapOnce() {
  ele.gotLock = true;
  await import('../src/main/index.js');
  // 解析 whenReady，等待 bootstrap 执行完。
  for (const r of ele.whenReadyResolvers) r();
  // 等待多轮微任务，确保 bootstrap 的 await 链全部完成。
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function clearAll() {
  for (const k of Object.keys(ele.appHandlers)) delete ele.appHandlers[k];
  for (const k of Object.keys(ele.powerHandlers)) delete ele.powerHandlers[k];
  for (const k of Object.keys(ele.screenHandlers)) delete ele.screenHandlers[k];
  ele.whenReadyResolvers.length = 0;
  ele.quit.mockClear();
  ele.exit.mockClear();
  Object.values(stubs.coordinator).forEach((f: any) => f.mockClear?.());
  Object.values(stubs.windows).forEach((f: any) => f.mockClear?.());
  stubs.windows.isEffectivelyHidden.mockReturnValue(false);
  stubs.coordinator.getSnapshot.mockReturnValue({ revision: 1, displayedActivityId: 'x', hidden: false });
  stubs.settingsState.hidden = false;
}

describe('生命周期：单实例锁', () => {
  beforeEach(() => {
    vi.resetModules();
    clearAll();
  });

  it('未拿到锁则 quit 且不运行 bootstrap', async () => {
    ele.gotLock = false;
    await import('../src/main/index.js');
    // 即便 whenReady 被解析，也不应有 bootstrap 的副作用（未注册 powerMonitor）。
    for (const r of ele.whenReadyResolvers) r();
    await new Promise((r) => setTimeout(r, 0));
    expect(ele.quit).toHaveBeenCalled();
    expect(ele.powerHandlers['suspend']).toBeUndefined();
  });
});

describe('生命周期：系统挂起/锁屏与用户隐藏独立', () => {
  beforeEach(() => {
    vi.resetModules();
    clearAll();
  });

  it('挂起停表并下发系统隐藏；不改用户隐藏偏好', async () => {
    await bootstrapOnce();
    stubs.coordinator.stop.mockClear();
    ele.emitPower('suspend');
    expect(stubs.coordinator.stop).toHaveBeenCalled();
    expect(stubs.windows.setSystemSuspended).toHaveBeenCalledWith(true);
    // 未通过 settings.update 写入 hidden。
    const wroteHidden = stubs.settings.update.mock.calls.some(
      (c: any[]) => c[0] && 'hidden' in c[0]
    );
    expect(wroteHidden).toBe(false);
  });

  it('挂起+锁屏重叠时，仅解锁不恢复显示/刷新', async () => {
    await bootstrapOnce();
    ele.emitPower('suspend');
    ele.emitPower('lock-screen');
    stubs.coordinator.start.mockClear();
    stubs.windows.setSystemSuspended.mockClear();
    // 解锁，但仍在挂起。
    ele.emitPower('unlock-screen');
    expect(stubs.coordinator.start).not.toHaveBeenCalled();
    // 仍应保持系统挂起（true），不解除。
    const lastCall = stubs.windows.setSystemSuspended.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(true);
  });

  it('挂起与锁屏都解除后才恢复：recompute + 解除系统隐藏 + start', async () => {
    await bootstrapOnce();
    ele.emitPower('suspend');
    ele.emitPower('lock-screen');
    stubs.coordinator.start.mockClear();
    stubs.coordinator.recompute.mockClear();
    stubs.windows.setSystemSuspended.mockClear();
    ele.emitPower('unlock-screen'); // 仍挂起
    ele.emitPower('resume'); // 两者都解除
    expect(stubs.coordinator.recompute).toHaveBeenCalled();
    expect(stubs.coordinator.start).toHaveBeenCalled();
    const lastCall = stubs.windows.setSystemSuspended.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(false);
  });

  it('用户隐藏时，系统恢复不启动每秒刷新', async () => {
    stubs.settingsState.hidden = true;
    await bootstrapOnce();
    ele.emitPower('suspend');
    stubs.coordinator.start.mockClear();
    ele.emitPower('resume');
    expect(stubs.coordinator.start).not.toHaveBeenCalled();
  });
});

describe('生命周期：崩溃重建清理气泡', () => {
  beforeEach(() => {
    vi.resetModules();
    clearAll();
  });

  it('pet 崩溃：清气泡、销毁、未隐藏则重建', async () => {
    await bootstrapOnce();
    const cb = petGoneCb();
    expect(cb).toBeTypeOf('function');
    stubs.windows.dismissBubble.mockClear();
    stubs.windows.destroyPet.mockClear();
    stubs.windows.createPetWindow.mockClear();
    cb!();
    expect(stubs.windows.dismissBubble).toHaveBeenCalled();
    expect(stubs.windows.destroyPet).toHaveBeenCalled();
    expect(stubs.windows.createPetWindow).toHaveBeenCalled();
  });

  it('pet 崩溃且用户隐藏：清气泡、销毁，但不重建', async () => {
    stubs.settingsState.hidden = true;
    await bootstrapOnce();
    const cb = petGoneCb();
    stubs.windows.dismissBubble.mockClear();
    stubs.windows.createPetWindow.mockClear();
    cb!();
    expect(stubs.windows.dismissBubble).toHaveBeenCalled();
    expect(stubs.windows.createPetWindow).not.toHaveBeenCalled();
  });
});

describe('生命周期：before-quit 防重入', () => {
  beforeEach(() => {
    vi.resetModules();
    clearAll();
  });

  it('首次拦截并收尾，重复触发不再拦截', async () => {
    await bootstrapOnce();
    const first = { prevented: false, preventDefault() { this.prevented = true; } };
    ele.emitApp('before-quit', first);
    expect(first.prevented).toBe(true);
    // 等待收尾异步完成。
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(stubs.settings.flush).toHaveBeenCalled();
    expect(ele.exit).toHaveBeenCalledWith(0);
    const second = { prevented: false, preventDefault() { this.prevented = true; } };
    ele.emitApp('before-quit', second);
    expect(second.prevented).toBe(false); // 不再拦截
  });
});
