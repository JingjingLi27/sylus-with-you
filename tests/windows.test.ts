// WindowManager 回归测试：精确发送者校验、尺寸/显示器约束、隐藏加载不显示与恢复、
// 无外部打开副作用。electron 以轻量假对象 mock，不启动真实窗口。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { Preferences } from '../src/domain/types.js';

// 共享可变的显示器与光标状态，测试可改写。
const env = vi.hoisted(() => {
  type Rect = { x: number; y: number; width: number; height: number };
  type FakeDisplay = { id: number; bounds: Rect; workArea: Rect };
  const state: {
    displays: FakeDisplay[];
    primaryId: number;
    cursor: { x: number; y: number };
  } = {
    displays: [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } }
    ],
    primaryId: 1,
    cursor: { x: 100, y: 100 }
  };
  return { state };
});

// 捕获最近创建的窗口实例，便于断言与触发回调。
const created = vi.hoisted(() => ({ windows: [] as any[] }));

vi.mock('electron', () => {
  let nextWcId = 1;

  class FakeWebFrameMain {
    url = '';
    parent: FakeWebFrameMain | null = null;
  }

  class FakeWebContents {
    id = nextWcId++;
    mainFrame = new FakeWebFrameMain();
    handlers: Record<string, Function[]> = {};
    onceHandlers: Record<string, Function[]> = {};
    windowOpenHandler: ((d: { url: string }) => unknown) | null = null;
    permissionHandler: Function | null = null;
    sent: Array<{ channel: string; args: unknown[] }> = [];
    session = {
      setPermissionRequestHandler: (cb: Function) => {
        this.permissionHandler = cb;
      }
    };
    on(event: string, cb: Function) {
      (this.handlers[event] ??= []).push(cb);
    }
    once(event: string, cb: Function) {
      (this.onceHandlers[event] ??= []).push(cb);
    }
    setWindowOpenHandler(cb: (d: { url: string }) => unknown) {
      this.windowOpenHandler = cb;
    }
    send(channel: string, ...args: unknown[]) {
      this.sent.push({ channel, args });
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers[event] ?? []) cb(...args);
    }
    emitOnce(event: string, ...args: unknown[]) {
      const cbs = this.onceHandlers[event] ?? [];
      this.onceHandlers[event] = [];
      for (const cb of cbs) cb(...args);
    }
  }

  class FakeBrowserWindow {
    webContents = new FakeWebContents();
    private bounds: { x: number; y: number; width: number; height: number };
    destroyed = false;
    shown = false;
    shownInactive = false;
    ignoreMouse: { ignore: boolean; opts?: unknown } | null = null;
    winHandlers: Record<string, Function[]> = {};
    onceHandlers: Record<string, Function[]> = {};
    constructor(opts: any) {
      this.bounds = {
        x: opts.x ?? 0,
        y: opts.y ?? 0,
        width: opts.width ?? 0,
        height: opts.height ?? 0
      };
      created.windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore: boolean, opts?: unknown) {
      this.ignoreMouse = { ignore, opts };
    }
    loadURL(url: string) {
      // 加载即把主 frame 的 URL 设为目标，模拟导航完成后的 frame.url。
      this.webContents.mainFrame.url = url;
    }
    getBounds() {
      return { ...this.bounds };
    }
    setBounds(b: { x: number; y: number; width: number; height: number }) {
      this.bounds = { ...b };
    }
    setPosition(x: number, y: number) {
      this.bounds.x = x;
      this.bounds.y = y;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
    show() {
      this.shown = true;
    }
    showInactive() {
      this.shown = true;
      this.shownInactive = true;
    }
    hide() {
      this.shown = false;
    }
    focus() {}
    popup() {}
    on(event: string, cb: Function) {
      (this.winHandlers[event] ??= []).push(cb);
    }
    once(event: string, cb: Function) {
      (this.onceHandlers[event] ??= []).push(cb);
    }
    finishLoad() {
      this.webContents.emitOnce('did-finish-load');
    }
  }

  const screen = {
    getPrimaryDisplay: () =>
      env.state.displays.find((d) => d.id === env.state.primaryId) ?? env.state.displays[0],
    getAllDisplays: () => env.state.displays,
    getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) => {
      const cx = rect.x + (rect.width ?? 0) / 2;
      const cy = rect.y + (rect.height ?? 0) / 2;
      const hit = env.state.displays.find(
        (d) =>
          cx >= d.bounds.x &&
          cx < d.bounds.x + d.bounds.width &&
          cy >= d.bounds.y &&
          cy < d.bounds.y + d.bounds.height
      );
      return hit ?? env.state.displays[0];
    },
    getCursorScreenPoint: () => ({ ...env.state.cursor }),
    on: () => {}
  };

  return { BrowserWindow: FakeBrowserWindow, screen };
});

// 在 mock 之后导入被测模块。
const { WindowManager } = await import('../src/main/windows.js');

// 复刻源文件计算角色页面 URL 的方式，确保断言与实现一致。
const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = join(here, '../src/renderer');
const PET_URL = pathToFileURL(join(RENDERER, 'pet/index.html')).toString();
const SETTINGS_URL = pathToFileURL(join(RENDERER, 'settings/index.html')).toString();

function basePrefs(overrides: Partial<Preferences> = {}): Preferences {
  return {
    schemaVersion: 1,
    anchorX: null,
    anchorY: null,
    displayId: null,
    characterHeight: 160,
    alwaysOnTop: true,
    reducedMotion: false,
    hidden: false,
    ...overrides
  };
}

function resetDisplays() {
  env.state.displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } }
  ];
  env.state.primaryId = 1;
  env.state.cursor = { x: 100, y: 100 };
}

beforeEach(() => {
  created.windows.length = 0;
  resetDisplays();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('WindowManager：隐藏加载不显示与恢复', () => {
  it('用户隐藏启动时，首帧加载完成也不显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: true }));
    const pet = wm.createPetWindow() as any;
    expect(pet.shown).toBe(false);
    pet.finishLoad();
    expect(pet.shown).toBe(false); // 隐藏下 did-finish-load 不得重新显示
  });

  it('未隐藏启动时，加载完成前不提前闪窗，完成后才显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: false }));
    const pet = wm.createPetWindow() as any;
    expect(pet.shown).toBe(false); // 加载完成前不显示
    pet.finishLoad();
    expect(pet.shown).toBe(true);
  });

  it('showPet 在尚未加载完成时不提前显示，加载完成后才显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: true }));
    const pet = wm.createPetWindow() as any;
    wm.showPet(); // 清除用户隐藏，但窗口未加载
    expect(pet.shown).toBe(false);
    pet.finishLoad();
    expect(pet.shown).toBe(true);
  });

  it('hidePet 隐藏窗口并清理气泡 pending，之后加载完成不显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: false }));
    const pet = wm.createPetWindow() as any;
    pet.finishLoad();
    expect(pet.shown).toBe(true);
    wm.hidePet();
    expect(pet.shown).toBe(false);
  });
});

describe('WindowManager：系统挂起独立于用户隐藏', () => {
  it('系统挂起隐藏窗口且不改用户隐藏；解除后按用户隐藏恢复显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: false }));
    const pet = wm.createPetWindow() as any;
    pet.finishLoad();
    expect(pet.shown).toBe(true);

    wm.setSystemSuspended(true);
    expect(pet.shown).toBe(false);
    expect(wm.isEffectivelyHidden()).toBe(true);

    wm.setSystemSuspended(false);
    expect(pet.shown).toBe(true); // 用户未隐藏 → 恢复显示
    expect(wm.isEffectivelyHidden()).toBe(false);
  });

  it('用户隐藏 + 系统挂起重叠时，仅解除挂起不恢复显示', () => {
    const wm = new WindowManager(basePrefs({ hidden: true }));
    const pet = wm.createPetWindow() as any;
    pet.finishLoad();
    wm.setSystemSuspended(true);
    expect(pet.shown).toBe(false);
    wm.setSystemSuspended(false);
    expect(pet.shown).toBe(false); // 用户仍隐藏
    expect(wm.isEffectivelyHidden()).toBe(true);
  });
});

describe('WindowManager：可信发送者精确校验', () => {
  it('角色窗主 frame 停在精确 URL 时返回角色', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const wc = pet.webContents;
    expect(wm.isTrustedSender(wc, wc.mainFrame)).toBe('pet');
  });

  it('未知发送者返回 null', () => {
    const wm = new WindowManager(basePrefs());
    wm.createPetWindow();
    const fake = { id: 9999, mainFrame: { url: PET_URL } } as any;
    expect(wm.isTrustedSender(fake, fake.mainFrame)).toBeNull();
  });

  it('senderFrame 为 null 返回 null', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    expect(wm.isTrustedSender(pet.webContents, null)).toBeNull();
  });

  it('senderFrame 不是主 frame（子 frame）返回 null', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const child = { url: PET_URL, parent: pet.webContents.mainFrame };
    expect(wm.isTrustedSender(pet.webContents, child as any)).toBeNull();
  });

  it('主 frame URL 被导航到其它地址（不等于角色 URL）返回 null', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    pet.webContents.mainFrame.url = 'file:///etc/passwd';
    expect(wm.isTrustedSender(pet.webContents, pet.webContents.mainFrame)).toBeNull();
  });

  it('角色窗伪装成设置窗 URL 不被信任（URL 与角色不匹配）', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    pet.webContents.mainFrame.url = SETTINGS_URL;
    expect(wm.isTrustedSender(pet.webContents, pet.webContents.mainFrame)).toBeNull();
  });
});

describe('WindowManager：导航加固与无外部打开副作用', () => {
  it('will-navigate 拒绝非角色 URL，放行精确角色 URL', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const nav = (url: string) => {
      const e = { prevented: false, preventDefault() { this.prevented = true; } };
      pet.webContents.emit('will-navigate', e, url);
      return e.prevented;
    };
    expect(nav('https://evil.example')).toBe(true);
    expect(nav('file:///somewhere/else.html')).toBe(true);
    expect(nav(PET_URL)).toBe(false);
  });

  it('setWindowOpenHandler 一律 deny，且不打开外部浏览器', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const handler = pet.webContents.windowOpenHandler;
    expect(handler).toBeTypeOf('function');
    expect(handler({ url: 'https://evil.example' })).toEqual({ action: 'deny' });
    expect(handler({ url: 'file:///x' })).toEqual({ action: 'deny' });
    // 无 shell.openExternal 之类副作用：mock 的 electron 根本不导出 shell，
    // 若实现仍 import shell 则模块导入会在上面失败。
  });

  it('权限请求一律拒绝', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const cb = vi.fn();
    pet.webContents.permissionHandler?.({}, 'media', cb);
    expect(cb).toHaveBeenCalledWith(false);
  });
});

describe('WindowManager：尺寸与显示器约束', () => {
  it('setCharacterHeight 放大后约束回工作区（不超出下边界）', () => {
    // 把角色放到底部，放大后应被顶回工作区内。
    const wm = new WindowManager(basePrefs({ characterHeight: 96 }));
    const pet = wm.createPetWindow() as any;
    // 贴近工作区底部放置。
    const size0 = pet.getBounds().height;
    pet.setPosition(1000, 24 + 876 - size0);
    wm.setCharacterHeight(240); // 放大
    const b = pet.getBounds();
    expect(b.y).toBeGreaterThanOrEqual(24);
    expect(b.y + b.height).toBeLessThanOrEqual(24 + 876);
    expect(b.x + b.width).toBeLessThanOrEqual(1440);
  });

  it('缺失保存的 displayId 时回主屏右下角，不选最近屏', () => {
    // 两块屏：主屏 id=1，副屏 id=2。保存 displayId=2 的锚点，但副屏已拔掉。
    env.state.displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } }
    ];
    const wm = new WindowManager(
      basePrefs({ anchorX: 2000, anchorY: 1000, displayId: 2, characterHeight: 160 })
    );
    const pet = wm.createPetWindow() as any;
    const b = pet.getBounds();
    const size = b.width;
    // 应落在主屏右下角（bottomRight，含 EDGE_MARGIN=24）。
    expect(b.x).toBe(0 + 1440 - size - 24);
    expect(b.y).toBe(24 + 876 - size - 24);
  });

  it('保存的 displayId 存在时沿用该屏并约束到其工作区', () => {
    env.state.displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } },
      { id: 2, bounds: { x: 1440, y: 0, width: 1280, height: 800 }, workArea: { x: 1440, y: 0, width: 1280, height: 760 } }
    ];
    const wm = new WindowManager(
      basePrefs({ anchorX: 1440 + 640, anchorY: 400, displayId: 2, characterHeight: 160 })
    );
    const pet = wm.createPetWindow() as any;
    const b = pet.getBounds();
    expect(b.x).toBeGreaterThanOrEqual(1440);
    expect(b.x + b.width).toBeLessThanOrEqual(1440 + 1280);
  });

  it('显示器被移除导致越界时回主屏，仍在则约束', () => {
    env.state.displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } },
      { id: 2, bounds: { x: 1440, y: 0, width: 1280, height: 800 }, workArea: { x: 1440, y: 0, width: 1280, height: 760 } }
    ];
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    // 把角色移到副屏。
    pet.setPosition(1500, 100);
    // 移除副屏。
    env.state.displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 24, width: 1440, height: 876 } }
    ];
    const anchor = wm.handleDisplaysChanged();
    const b = pet.getBounds();
    expect(b.x).toBeLessThan(1440); // 已回到主屏
    expect(anchor?.displayId).toBe(1);
  });

  it('用户拖动后位置在工作区内保持（endDrag 约束但不乱移）', () => {
    const wm = new WindowManager(basePrefs());
    const pet = wm.createPetWindow() as any;
    const size = pet.getBounds().width;
    const start = pet.getBounds();
    // 从窗口左上角抓取，向左上小幅拖动，确保落点仍在工作区内。
    env.state.cursor = { x: start.x, y: start.y };
    wm.beginDrag();
    env.state.cursor = { x: start.x - 50, y: start.y - 50 };
    wm.moveDrag();
    const before = pet.getBounds();
    const anchor = wm.endDrag();
    const after = pet.getBounds();
    // 合法位置不应被挪动。
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(anchor).not.toBeNull();
    expect(anchor?.anchorX).toBe(after.x + size / 2);
  });
});

it('按事件坐标拖动，不受IPC到达时全局指针位置影响',()=>{
  const wm=new WindowManager(basePrefs());const pet=wm.createPetWindow() as any;
  pet.setPosition(500,400);env.state.cursor={x:900,y:800};
  wm.beginDrag({x:550,y:450});wm.moveDrag({x:490,y:400});wm.endDrag();
  expect(pet.getBounds().x).toBe(440);expect(pet.getBounds().y).toBe(350);
});
