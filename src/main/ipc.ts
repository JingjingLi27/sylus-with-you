// 受限 IPC：集中注册所有通道处理器，按窗口角色限制允许的通道，校验主 frame 与本地页面。
// 只暴露明确列出的操作；不提供任意文件读写或命令执行。

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { CH } from '../shared/channels.js';
import { listVisualAssets } from '../domain/assets.js';
import { sanitizePreferencePatch, type PreferencePatch } from '../domain/preferences.js';
import type { StateCoordinator } from './coordinator.js';
import type { WindowManager } from './windows.js';
import type { SettingsStore } from './settings.js';
import type { ScheduleSlot } from '../domain/types.js';
import type { RuntimeManifest } from '../shared/api.js';

export type IpcDeps = {
  coordinator: StateCoordinator;
  windows: WindowManager;
  settings: SettingsStore;
  slots: ScheduleSlot[];
  manifest: RuntimeManifest;
  applyPreferences: (patch: PreferencePatch) => void;
  onShowStatus: () => void;
  onOpenMenu: () => void;
  onEndDrag: () => void;
  onBubbleReady: () => void;
};

type Role = 'pet' | 'bubble' | 'settings';

// 每个通道允许的发送者角色。请求-响应通道允许读数据的窗口（角色窗与设置窗）。
const CHANNEL_ROLES: Record<string, Role[]> = {
  [CH.getSnapshot]: ['pet', 'settings'],
  [CH.getPreferences]: ['settings'],
  [CH.getScheduleSlots]: ['pet', 'settings'],
  [CH.getVisualAssets]: ['pet', 'settings'],
  [CH.getRuntimeManifest]: ['settings'],
  [CH.setPreviewMinute]: ['settings'],
  [CH.clearPreview]: ['settings'],
  [CH.updatePreferences]: ['settings'],
  [CH.beginDrag]: ['pet'],
  [CH.moveDrag]: ['pet'],
  [CH.endDrag]: ['pet'],
  [CH.setPointerHit]: ['pet'],
  [CH.showStatus]: ['pet'],
  [CH.openMenu]: ['pet'],
  [CH.bubbleReady]: ['bubble']
};

export function registerIpc(deps: IpcDeps): () => void {
  const { coordinator, windows, settings, slots, manifest, applyPreferences } = deps;

  // 校验：发送者是已知窗口、来自其主 frame 且该主 frame 停在该角色绑定的精确本地 URL、
  // 并且该通道允许此角色。精确 URL 校验由 WindowManager.isTrustedSender 负责，
  // 不只检查 parent===null（子 frame 既可能 parent 为 null，被导航后 URL 也会不符）。
  const allow = (
    channel: string,
    e: IpcMainEvent | IpcMainInvokeEvent
  ): boolean => {
    const role = windows.isTrustedSender(e.sender, e.senderFrame ?? null);
    if (!role) return false;
    const roles = CHANNEL_ROLES[channel];
    return !!roles && roles.includes(role);
  };

  const onCmd = (
    channel: string,
    handler: (e: IpcMainEvent, ...args: unknown[]) => void
  ) => {
    ipcMain.on(channel, (e: IpcMainEvent, ...args: unknown[]) => {
      if (!allow(channel, e)) return;
      handler(e, ...args);
    });
  };

  const onReq = <T>(channel: string, handler: () => T) => {
    ipcMain.handle(channel, (e: IpcMainInvokeEvent) => {
      if (!allow(channel, e)) throw new Error('forbidden sender/channel');
      return handler();
    });
  };

  // 请求-响应
  onReq(CH.getSnapshot, () => coordinator.getSnapshot());
  onReq(CH.getPreferences, () => settings.get());
  onReq(CH.getScheduleSlots, () => slots);
  onReq(CH.getVisualAssets, () => listVisualAssets());
  onReq(CH.getRuntimeManifest, () => manifest);

  // 预览与偏好（仅设置窗）
  onCmd(CH.setPreviewMinute, (_e, minute) => coordinator.setPreviewMinute(minute));
  onCmd(CH.clearPreview, () => coordinator.clearPreview());
  onCmd(CH.updatePreferences, (_e, patch) =>
    applyPreferences(sanitizePreferencePatch(patch))
  );

  // 角色窗交互（仅角色窗）
  const pointArg = (value: unknown): {x: number; y: number} | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const p = value as Record<string, unknown>;
    if (typeof p.x !== 'number' || typeof p.y !== 'number' ||
        !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000) return undefined;
    return {x:p.x,y:p.y};
  };
  onCmd(CH.beginDrag, (_e, value) => {
    const point = pointArg(value);
    if (value === undefined || point) windows.beginDrag(point);
  });
  onCmd(CH.moveDrag, (_e, value) => {
    const point = pointArg(value);
    if (value === undefined || point) windows.moveDrag(point);
  });
  onCmd(CH.endDrag, () => deps.onEndDrag());
  onCmd(CH.setPointerHit, (_e, hit) => {
    if (typeof hit === 'boolean') windows.setPointerHit(hit);
  });
  onCmd(CH.showStatus, () => deps.onShowStatus());
  onCmd(CH.openMenu, () => deps.onOpenMenu());

  // 气泡窗握手
  onCmd(CH.bubbleReady, () => deps.onBubbleReady());

  return () => {
    for (const ch of Object.values(CH)) {
      ipcMain.removeHandler(ch);
      ipcMain.removeAllListeners(ch);
    }
  };
}
