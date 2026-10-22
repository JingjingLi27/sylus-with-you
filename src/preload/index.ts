// 受限 preload：在 contextIsolation + sandbox 下运行，只通过 contextBridge 暴露
// 明确列出的方法；不暴露 ipcRenderer、require、文件系统或任意通道。
// 主进程仍会再次校验发送者与参数——preload 的校验只是第一道，不作为信任边界。

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH } from '../shared/channels.js';
import type { CompanionApi } from '../shared/api.js';

function toInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

const api: CompanionApi = {
  getSnapshot: () => ipcRenderer.invoke(CH.getSnapshot),

  onSnapshot: (callback) => {
    const listener = (_e: IpcRendererEvent, snapshot: unknown) => {
      callback(snapshot as never);
    };
    ipcRenderer.on(CH.snapshot, listener);
    return () => ipcRenderer.removeListener(CH.snapshot, listener);
  },

  getPreferences: () => ipcRenderer.invoke(CH.getPreferences),
  getScheduleSlots: () => ipcRenderer.invoke(CH.getScheduleSlots),
  getVisualAssets: () => ipcRenderer.invoke(CH.getVisualAssets),
  getRuntimeManifest: () => ipcRenderer.invoke(CH.getRuntimeManifest),

  setPreviewMinute: (minute) => {
    const m = toInt(minute);
    if (m === null) return; // 非整数直接忽略；主进程还会再做范围校验。
    ipcRenderer.send(CH.setPreviewMinute, m);
  },
  clearPreview: () => ipcRenderer.send(CH.clearPreview),

  updatePreferences: (patch) => {
    // 仅透传普通对象；主进程按白名单裁剪字段。
    if (typeof patch !== 'object' || patch === null) return;
    ipcRenderer.send(CH.updatePreferences, patch);
  },

  beginDrag: (point) => ipcRenderer.send(CH.beginDrag, point),
  moveDrag: (point) => ipcRenderer.send(CH.moveDrag, point),
  endDrag: () => ipcRenderer.send(CH.endDrag),
  setPointerHit: (hit) => {
    if (typeof hit !== 'boolean') return;
    ipcRenderer.send(CH.setPointerHit, hit);
  },
  showStatus: () => ipcRenderer.send(CH.showStatus),
  openMenu: () => ipcRenderer.send(CH.openMenu),

  onBubble: (callback) => {
    const listener = (_e: IpcRendererEvent, text: unknown, ttlMs: unknown) => {
      if (typeof text !== 'string') return;
      callback(text, typeof ttlMs === 'number' ? ttlMs : 5000);
    };
    ipcRenderer.on(CH.bubble, listener);
    return () => ipcRenderer.removeListener(CH.bubble, listener);
  },
  bubbleReady: () => ipcRenderer.send(CH.bubbleReady)
};

contextBridge.exposeInMainWorld('companion', api);
