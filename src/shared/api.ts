// preload 暴露到渲染进程 window.companion 的类型契约。渲染进程以此获得类型安全，
// 不直接接触 ipcRenderer。所有方法都对应 channels.ts 中的通道，由主进程校验来源与参数。

import type { PreferencePatch } from '../domain/preferences.js';
import type { VisualAsset } from '../domain/assets.js';
import type { Preferences, RuntimeSnapshot, ScheduleSlot } from '../domain/types.js';

export type RuntimeManifest = {
  schemaVersion: number;
  generatedAt: string;
  note: string;
  gifs: Array<{
    visualId: string;
    file: string;
    width: number | null;
    height: number | null;
    frames: number | null;
    durationMs: number | null;
    sha256: string | null;
    sourceId: string | null;
  }>;
  missing: string[];
};

export interface CompanionApi {
  // 通用状态
  getSnapshot(): Promise<RuntimeSnapshot>;
  onSnapshot(callback: (snapshot: RuntimeSnapshot) => void): () => void;

  // 设置窗数据
  getPreferences(): Promise<Preferences>;
  getScheduleSlots(): Promise<ScheduleSlot[]>;
  getVisualAssets(): Promise<VisualAsset[]>;
  getRuntimeManifest(): Promise<RuntimeManifest>;

  // 预览与偏好
  setPreviewMinute(minute: number): void;
  clearPreview(): void;
  updatePreferences(patch: PreferencePatch): void;

  // 角色窗交互
  beginDrag(point?: { x: number; y: number }): void;
  moveDrag(point?: { x: number; y: number }): void;
  endDrag(): void;
  setPointerHit(hit: boolean): void;
  showStatus(): void;
  openMenu(): void;

  // 气泡窗
  onBubble(callback: (text: string, ttlMs: number) => void): () => void;
  /** 气泡页面注册完监听后调用，通知主进程可以发送文本。 */
  bubbleReady(): void;
}

declare global {
  interface Window {
    companion: CompanionApi;
  }
}
