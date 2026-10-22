// StateCoordinator：主进程唯一的状态权威。协调真实时间、预览、隐藏、减少动态效果，
// 发布带递增 revision 的快照。可见期间每秒重算；仅当展示数据变化时才通知订阅者。
// 时钟可注入，便于测试与 Codex 验证（不改系统时钟）。

import {
  INITIAL_COORDINATOR_STATE,
  buildSnapshot,
  snapshotDisplayEqual,
  type CoordinatorState
} from '../domain/state.js';
import { sanitizePreviewMinute } from '../domain/preferences.js';
import type { RuntimeSnapshot, ScheduleSlot } from '../domain/types.js';

export type Clock = () => Date;

const TICK_MS = 1000;

export class StateCoordinator {
  private state: CoordinatorState = { ...INITIAL_COORDINATOR_STATE };
  private revision = 0;
  private last: RuntimeSnapshot | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly listeners = new Set<(s: RuntimeSnapshot) => void>();

  constructor(
    private readonly slots: ScheduleSlot[],
    private readonly clock: Clock = () => new Date()
  ) {}

  /** 当前快照；若尚未计算则立即计算一份。 */
  getSnapshot(): RuntimeSnapshot {
    if (!this.last) {
      this.last = buildSnapshot(this.state, this.clock(), this.slots, ++this.revision);
    }
    return this.last;
  }

  subscribe(listener: (s: RuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    // 新订阅者立即获得当前快照。
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  /** 开始每秒重算。可见期间调用；隐藏/锁屏可停表以省刷新。 */
  start(): void {
    if (this.ticking) return;
    this.ticking = true;
    this.recompute();
    this.timer = setInterval(() => this.recompute(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  /** 停止每秒重算（逻辑作息不暂停，恢复显示前必须 recompute）。 */
  stop(): void {
    this.ticking = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 立即重算一次。启动、恢复显示、退出预览、系统唤醒、时区变化时调用。
   * 仅当展示数据相对上次变化时才广播，避免每秒写盘或重载图片。
   */
  recompute(): RuntimeSnapshot {
    const next = buildSnapshot(this.state, this.clock(), this.slots, this.revision + 1);
    if (this.last && snapshotDisplayEqual(this.last, next)) {
      return this.last; // 展示无变化，不递增 revision、不广播。
    }
    this.revision += 1;
    this.last = next;
    this.emit(next);
    return next;
  }

  // --- 模式与状态变更，均走 recompute 以统一广播 ---

  setPreviewMinute(minuteInput: unknown): void {
    const minute = sanitizePreviewMinute(minuteInput);
    if (minute === null) return;
    this.state = { ...this.state, mode: 'preview', previewMinute: minute };
    this.recompute();
  }

  clearPreview(): void {
    if (this.state.mode === 'realtime') return;
    this.state = { ...this.state, mode: 'realtime', previewMinute: null };
    this.recompute();
  }

  setHidden(hidden: boolean): void {
    if (this.state.hidden === hidden) return;
    this.state = { ...this.state, hidden };
    this.recompute();
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.state.reducedMotion === reducedMotion) return;
    this.state = { ...this.state, reducedMotion };
    this.recompute();
  }

  isPreviewing(): boolean {
    return this.state.mode === 'preview';
  }

  private emit(snapshot: RuntimeSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
