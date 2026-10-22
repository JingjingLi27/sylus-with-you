// IPC 回归测试：通道按角色与可信发送者精确门控。
// 用假 ipcMain 捕获注册的处理器；WindowManager 以存根提供 isTrustedSender。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../src/shared/channels.js';

type Listener = (e: any, ...args: unknown[]) => unknown;

const bus = vi.hoisted(() => ({
  on: new Map<string, Listener>(),
  handle: new Map<string, Listener>()
}));

vi.mock('electron', () => {
  const ipcMain = {
    on: (ch: string, cb: Listener) => bus.on.set(ch, cb),
    handle: (ch: string, cb: Listener) => bus.handle.set(ch, cb),
    removeHandler: (ch: string) => bus.handle.delete(ch),
    removeAllListeners: (ch: string) => bus.on.delete(ch)
  };
  return { ipcMain };
});

// 领域依赖以存根替代，避免引入真实实现噪声。
vi.mock('../src/domain/assets.js', () => ({ listVisualAssets: () => [] }));
vi.mock('../src/domain/preferences.js', () => ({
  sanitizePreferencePatch: (p: unknown) => p
}));

const { registerIpc } = await import('../src/main/ipc.js');

type Role = 'pet' | 'bubble' | 'settings';

function makeDeps(trusted: (sender: any, frame: any) => Role | null) {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const coordinator = {
    getSnapshot: () => ({ revision: 1 }),
    setPreviewMinute: () => bump('setPreviewMinute'),
    clearPreview: () => bump('clearPreview')
  };
  const windows = {
    isTrustedSender: trusted,
    beginDrag: () => bump('beginDrag'),
    moveDrag: () => bump('moveDrag'),
    setPointerHit: () => bump('setPointerHit')
  };
  const settings = { get: () => ({ hidden: false }) };
  const deps = {
    coordinator,
    windows,
    settings,
    slots: [],
    manifest: { schemaVersion: 1 },
    applyPreferences: () => bump('applyPreferences'),
    onShowStatus: () => bump('onShowStatus'),
    onOpenMenu: () => bump('onOpenMenu'),
    onEndDrag: () => bump('onEndDrag'),
    onBubbleReady: () => bump('onBubbleReady')
  } as any;
  return { deps, calls };
}

// 构造带 sender/senderFrame 的假事件。
function evt(role: Role) {
  const mainFrame = { url: `local://${role}` };
  const sender = { id: role === 'pet' ? 1 : role === 'settings' ? 2 : 3, mainFrame };
  return { sender, senderFrame: mainFrame };
}

beforeEach(() => {
  bus.on.clear();
  bus.handle.clear();
});

describe('IPC：可信发送者门控', () => {
  it('不可信发送者（isTrustedSender 返回 null）命令被忽略', () => {
    const { deps, calls } = makeDeps(() => null);
    registerIpc(deps);
    bus.on.get(CH.beginDrag)!(evt('pet'));
    expect(calls.beginDrag).toBeUndefined();
  });

  it('不可信发送者 invoke 抛出 forbidden', () => {
    const { deps } = makeDeps(() => null);
    registerIpc(deps);
    expect(() => bus.handle.get(CH.getSnapshot)!(evt('pet'))).toThrow(/forbidden/);
  });

  it('角色不匹配的命令被忽略：settings 发角色窗专属 beginDrag', () => {
    // settings 可信但角色为 settings；beginDrag 仅允许 pet。
    const { deps, calls } = makeDeps(() => 'settings');
    registerIpc(deps);
    bus.on.get(CH.beginDrag)!(evt('settings'));
    expect(calls.beginDrag).toBeUndefined();
  });

  it('pet 可信时 beginDrag 被执行', () => {
    const { deps, calls } = makeDeps(() => 'pet');
    registerIpc(deps);
    bus.on.get(CH.beginDrag)!(evt('pet'));
    expect(calls.beginDrag).toBe(1);
  });

  it('settings 可信时 updatePreferences 被执行，pet 不行', () => {
    const asSettings = makeDeps(() => 'settings');
    registerIpc(asSettings.deps);
    bus.on.get(CH.updatePreferences)!(evt('settings'), { hidden: true });
    expect(asSettings.calls.applyPreferences).toBe(1);

    bus.on.clear();
    bus.handle.clear();
    const asPet = makeDeps(() => 'pet');
    registerIpc(asPet.deps);
    bus.on.get(CH.updatePreferences)!(evt('pet'), { hidden: true });
    expect(asPet.calls.applyPreferences).toBeUndefined();
  });

  it('bubbleReady 仅 bubble 角色可触发', () => {
    const { deps, calls } = makeDeps(() => 'bubble');
    registerIpc(deps);
    bus.on.get(CH.bubbleReady)!(evt('bubble'));
    expect(calls.onBubbleReady).toBe(1);
  });

  it('setPointerHit 仅接受布尔参数', () => {
    const { deps, calls } = makeDeps(() => 'pet');
    registerIpc(deps);
    bus.on.get(CH.setPointerHit)!(evt('pet'), 'notbool');
    expect(calls.setPointerHit).toBeUndefined();
    bus.on.get(CH.setPointerHit)!(evt('pet'), true);
    expect(calls.setPointerHit).toBe(1);
  });

  it('isTrustedSender 收到的是 sender 与 senderFrame', () => {
    const seen: any[] = [];
    const { deps } = makeDeps((sender, frame) => {
      seen.push({ sender, frame });
      return 'pet';
    });
    registerIpc(deps);
    const e = evt('pet');
    bus.on.get(CH.beginDrag)!(e);
    expect(seen[0].sender).toBe(e.sender);
    expect(seen[0].frame).toBe(e.senderFrame);
  });

  it('cleanup 后处理器被移除', () => {
    const { deps } = makeDeps(() => 'pet');
    const cleanup = registerIpc(deps);
    expect(bus.on.has(CH.beginDrag)).toBe(true);
    cleanup();
    expect(bus.on.has(CH.beginDrag)).toBe(false);
    expect(bus.handle.has(CH.getSnapshot)).toBe(false);
  });
});

it('拒绝非法指针坐标，接受有限的屏幕坐标',()=>{
  const {deps,calls}=makeDeps(()=>'pet');registerIpc(deps);
  for(const value of [{x:NaN,y:0},{x:Infinity,y:2},{x:'1',y:2},{x:1e9,y:2},null]){
    bus.on.get(CH.beginDrag)!(evt('pet'),value);
  }
  expect(calls.beginDrag).toBeUndefined();
  bus.on.get(CH.beginDrag)!(evt('pet'),{x:-100,y:200});expect(calls.beginDrag).toBe(1);
});
