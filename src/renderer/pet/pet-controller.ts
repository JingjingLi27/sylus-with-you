// 角色窗的状态与异步编排核心（无 DOM 依赖，便于回归）。
// 把“解析素材 / 加载 / 绘制 / 启停循环 / 命中复查 / 取消手势”抽成注入依赖，
// 由渲染进程（index.ts）接入真实实现，测试则注入可控的 fake 与 deferred。
//
// 修正要点：
// - 任何目标变化都递增 loadToken 作废旧异步加载；隐藏、冻结（手势）同样作废。
// - 切换视觉立即 stopLoop，异步结果到达时校验 token / 隐藏 / 冻结，过期一律丢弃，旧结果不覆盖新目标。
// - currentVisualId 与“实际已加载标识 loadedVisualId”分离：隐藏期间可更新目标，恢复时按最新目标判断
//   是重启已加载动画，还是重新加载（恢复到最新活动而非旧动画）。
// - 同一 visualId 不同活动（lunch/breakfast→eat、home/unknown→idle）标签需刷新：占位重绘，共享真实 GIF 重叠标签。
// - 手势按下到释放整段冻结画面与命中（stopLoop + 作废加载），期间仍缓存最新快照，松手应用最新目标或恢复当前动画。
// - 隐藏优先取消手势，不被 pending 拖住。

import type { LoadedAnimation } from './gif-player.js';
import type { VisualAsset } from '../../domain/assets.js';
import type { RuntimeSnapshot } from '../../domain/types.js';

export interface ControllerDeps {
  /** 解析 visualId → 素材清单项（可能缺失）。 */
  resolveAsset(visualId: string): VisualAsset | undefined;
  /** 加载真实 GIF 动画。 */
  loadAnimation(file: string): Promise<LoadedAnimation>;
  /** 加载占位基础帧（现有人形代表帧）；无基础或失败返回 null。 */
  loadPlaceholderBase(baseFile: string | null): Promise<ImageData | null>;
  /** 该视觉是否被多个活动共享（需叠加活动标签以区分，例如 idle→回家/？）。 */
  isSharedVisual(visualId: string): boolean;
  /** 开始动画循环（reducedMotion 时停在代表帧）。 */
  startLoop(animation: LoadedAnimation, reducedMotion: boolean): void;
  /** 停止动画循环。 */
  stopLoop(): void;
  /** 绘制占位帧（干净底帧 + 道具 + 标签，不含预览标识）。 */
  paintPlaceholder(visualId: string, label: string, base: ImageData | null): void;
  /** 用当前干净底帧重绘叠加层（活动标签 / 预览标识），可增可删，不改命中掩码。 */
  repaintOverlays(): void;
  /** 按最近指针位置复查命中（换帧 / 重绘后）。 */
  recheckHit(): void;
  /** 取消进行中的手势（隐藏优先，不被 pending 拖住）。 */
  cancelGesture(): void;
}

export class PetController {
  private latest: RuntimeSnapshot | null = null;
  private presented: RuntimeSnapshot | null = null;
  private frozen = false;
  private loadToken = 0;
  private loadingVisual: string | null = null;
  private loaded: {
    visualId: string;
    label: string;
    animation: LoadedAnimation | null;
    base: ImageData | null;
  } | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  get previewMode(): boolean {
    return this.presented?.mode === 'preview';
  }

  get activeOverlayLabel(): string | null {
    return this.loaded?.animation && this.deps.isSharedVisual(this.loaded.visualId)
      ? this.loaded.label
      : null;
  }

  onSnapshot(snapshot: RuntimeSnapshot): void {
    if (this.latest && snapshot.revision < this.latest.revision) return;
    this.latest = snapshot;
    if (snapshot.hidden) {
      // 先解除冻结并作废加载，再取消手势，避免取消回调重新播放旧画面。
      this.frozen = false;
      this.invalidateLoad();
      this.presented = snapshot;
      this.deps.stopLoop();
      this.deps.cancelGesture();
      return;
    }
    if (!this.frozen) this.reconcile();
  }

  freeze(): void {
    if (this.latest?.hidden) return;
    this.frozen = true;
    this.invalidateLoad();
    this.deps.stopLoop();
  }

  release(): void {
    if (!this.frozen) return;
    this.frozen = false;
    // 无论是否收到新快照，都按最新目标与实际已加载画面核对。
    this.reconcile(true);
  }

  private invalidateLoad(): void {
    this.loadToken += 1;
    this.loadingVisual = null;
  }

  private reconcile(resume = false): void {
    const target = this.latest;
    if (!target || target.hidden || this.frozen) return;
    const before = this.presented;
    this.presented = target;
    const { visualId, label } = target.displayedSlot;

    if (!this.loaded || this.loaded.visualId !== visualId) {
      if (this.loadingVisual !== visualId) void this.load(visualId);
      return;
    }

    const interrupted = this.loadingVisual !== null;
    if (interrupted) this.invalidateLoad();
    const labelChanged = this.loaded.label !== label;
    this.loaded.label = label;
    const previewChanged = before?.mode !== target.mode;
    const restart = resume || interrupted || before?.hidden ||
      before?.displayedSlot.visualId !== visualId ||
      before?.reducedMotion !== target.reducedMotion;

    if (this.loaded.animation) {
      if (restart) this.deps.startLoop(this.loaded.animation, target.reducedMotion);
      else if (labelChanged || previewChanged) this.deps.repaintOverlays();
    } else {
      if (labelChanged) this.deps.paintPlaceholder(visualId, label, this.loaded.base);
      if (labelChanged || previewChanged || resume) this.deps.repaintOverlays();
    }
    this.deps.recheckHit();
  }

  private async load(visualId: string): Promise<void> {
    this.invalidateLoad();
    const token = this.loadToken;
    this.loadingVisual = visualId;
    this.deps.stopLoop();
    const asset = this.deps.resolveAsset(visualId);
    let animation: LoadedAnimation | null = null;
    let base: ImageData | null = null;
    if (asset?.file) {
      try { animation = await this.deps.loadAnimation(asset.file); }
      catch { /* 素材异常时使用现有人形代表帧兜底。 */ }
    }
    const valid = (): boolean => token === this.loadToken && !this.frozen &&
      !!this.latest && !this.latest.hidden && this.latest.displayedSlot.visualId === visualId;
    if (!valid()) return;
    if (!animation) {
      const file = asset?.placeholderBaseFile ?? (asset?.file ? this.deps.resolveAsset('a16')?.file ?? this.deps.resolveAsset('idle')?.file : null) ?? null;
      try { base = await this.deps.loadPlaceholderBase(file); }
      catch { base = null; }
      if (!valid()) return;
    }
    this.loadingVisual = null;
    // 加载期间可能只改了同素材的标签或预览模式，呈现最新快照而非闭包旧值。
    const target = this.latest!;
    this.presented = target;
    this.loaded = { visualId, label: target.displayedSlot.label, animation, base };
    if (animation) this.deps.startLoop(animation, target.reducedMotion);
    else {
      this.deps.paintPlaceholder(visualId, this.loaded.label, base);
      this.deps.repaintOverlays();
    }
    this.deps.recheckHit();
  }
}
