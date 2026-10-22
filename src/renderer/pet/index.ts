// 角色窗渲染进程：订阅主进程快照，经 PetController 编排状态与异步加载，
// 播放 GIF 或占位帧，维护命中掩码并上报穿透状态，处理点击/拖动手势。
// 只通过 window.companion 与主进程通信。
//
// 关键修正：
// - 状态/异步逻辑抽到 PetController（可测试）：加载竞争、隐藏、手势冻结一律不让旧结果覆盖最新目标。
// - 命中坐标统一经 clientToCanvas 从 client/DIP 换算到 512 画布像素；resize/换帧/松手都重算。
// - 手势按下到释放整段冻结画面与命中，期间持续接收鼠标；armed 期间 pointerleave 不松开。
// - 干净底帧与叠加层（活动标签 / 预览标识）分离合成：叠加可增可删，且不改变角色命中掩码。
// - contextmenu 仅在命中角色处触发，透明处不弹菜单。

import { loadGifAnimation, type LoadedAnimation } from './gif-player.js';
import { HitMask } from './hit-mask.js';
import { GestureHandler } from './gestures.js';
import { clientToCanvas } from './coords.js';
import { compositePlaceholder } from './placeholder.js';
import { frameAt } from '../../domain/frame-clock.js';
import { AnimationTimeline } from '../../domain/animation-timeline.js';
import { VISUAL_ASSETS } from '../../domain/assets.js';
import { PetController } from './pet-controller.js';
import scheduleConfig from '../../config/schedule.json';
import type { RuntimeSnapshot, ScheduleSlot } from '../../domain/types.js';
import type { VisualAsset } from '../../domain/assets.js';

const CANVAS_SIZE = 512;

const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

const hitMask = new HitMask();

// 启动即开启穿透：加载首帧前不要留下整块可拦截的透明矩形。
window.companion.setPointerHit(false);

let visualAssets: VisualAsset[] = Object.values(VISUAL_ASSETS);
const timeline = new AnimationTimeline(() => performance.now());
let sourceSnapshot: RuntimeSnapshot | null = null;
let renderRevision=0;
let lastSelectionKey='';
let lastSourceRevision=-1;
let renderedVisual='';
// Bound decoded cache, so visiting the entire library cannot retain every bitmap.
const decodedCache=new Map<string,LoadedAnimation>();
async function loadCached(file:string):Promise<LoadedAnimation> {
 const cached=decodedCache.get(file);
 if(cached){decodedCache.delete(file);decodedCache.set(file,cached);return cached;}
 const loaded=await loadGifAnimation(assetUrl(file),CANVAS_SIZE);
 decodedCache.set(file,loaded);
 const bytes=()=>Array.from(decodedCache.values()).reduce((sum,a)=>sum+a.frames.length*CANVAS_SIZE*CANVAS_SIZE*4,0);
 while(decodedCache.size>1 && (decodedCache.size>3 || bytes()>64*1024*1024))decodedCache.delete(decodedCache.keys().next().value!);
 return loaded;
}

// 当前帧播放状态。
let animation: LoadedAnimation | null = null;
let durations: number[] = [];
let loopStartedAt = 0;
let rafId = 0;
let lastDrawnFrame = -1;
let reducedMotionNow = false;
// 最近一帧的“干净底帧”（真实帧或占位合成，不含叠加层），用于重绘叠加时还原。
let lastCleanFrame: ImageData | null = null;

function assetUrl(file: string): string {
  return `qinche-asset://runtime/${file.replace(/^\/+/, '')}`;
}

function hitTestClient(clientX: number, clientY: number): boolean {
  const p = clientToCanvas(clientX, clientY, canvas.getBoundingClientRect(), CANVAS_SIZE);
  return hitMask.hitTest(p.x, p.y);
}

/** 是否被多个活动共享同一视觉（需叠加活动标签区分，例如 idle→回家/？）。 */
function isSharedVisual(visualId: string): boolean {
  return sharedVisualIds.has(visualId);
}

// 预计算：出现在多个 schedule slot 的 visualId 视为共享（需活动标签区分，如 idle→回家/？、eat→午餐/早餐）。
const sharedVisualIds = ((): Set<string> => {
  const counts = new Map<string, number>();
  for (const slot of scheduleConfig.slots as ScheduleSlot[]) {
    counts.set(slot.visualId, (counts.get(slot.visualId) ?? 0) + 1);
  }
  const shared = new Set<string>();
  for (const [visualId, n] of counts) if (n > 1) shared.add(visualId);
  return shared;
})();

/** 把一帧真实 bitmap 绘到画布：底帧更新命中掩码，再叠加层。 */
function paintFrame(image: ImageData): void {
  lastCleanFrame = image;
  ctx.putImageData(image, 0, 0);
  hitMask.update(image); // 命中基于干净角色像素，不含叠加层。
  drawOverlays();
}

/** 重绘叠加层：先还原干净底帧，再按需叠加活动标签与预览标识（可增可删，不改掩码）。 */
function repaintOverlays(): void {
  if (lastCleanFrame) {
    ctx.putImageData(lastCleanFrame, 0, 0);
  }
  drawOverlays();
}

/** 叠加活动标签（共享真实 GIF）与预览标识；两者都不计入命中掩码。 */
function drawOverlays(): void {
  const label = controller.activeOverlayLabel;
  if (label) drawLabelChip(label);
  if (controller.previewMode) drawPreviewBadge();
}

/** 共享真实 GIF 上叠加底部活动小标，区分同一视觉的不同活动（回家/？）。 */
function drawLabelChip(label: string): void {
  const s = CANVAS_SIZE;
  const cx = s / 2;
  ctx.save();
  ctx.font = `${Math.round(s * 0.078)}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(s * 0.9, ctx.measureText(label).width + s * 0.12);
  const h = s * 0.11;
  const x = cx - w / 2;
  const y = s - s * 0.055 - h;
  roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(122, 31, 43, 0.9)';
  ctx.fill();
  ctx.fillStyle = '#f6ece2';
  ctx.fillText(label, cx, y + h / 2);
  ctx.restore();
}

/** 预览模式下在角色窗顶部画清晰的小“预览”标识（不计入命中区域）。 */
function drawPreviewBadge(): void {
  const s = CANVAS_SIZE;
  const text = '预览';
  ctx.save();
  ctx.font = `${Math.round(s * 0.072)}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + s * 0.09;
  const h = s * 0.1;
  const x = s / 2 - w / 2;
  const y = s * 0.03;
  roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(156, 51, 64, 0.95)';
  ctx.fill();
  ctx.fillStyle = '#f6ece2';
  ctx.fillText(text, s / 2, y + h / 2);
  ctx.restore();
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 占位基础帧缓存：现有人形代表帧，按 placeholderBaseFile 复用，避免重复解码。
const placeholderBaseCache = new Map<string, ImageData | null>();

async function loadPlaceholderBase(baseFile: string | null): Promise<ImageData | null> {
  if (!baseFile) return null;
  if (placeholderBaseCache.has(baseFile)) return placeholderBaseCache.get(baseFile) ?? null;
  try {
    const loaded = await loadGifAnimation(assetUrl(baseFile), CANVAS_SIZE);
    const first = loaded.frames[0]?.bitmap ?? null;
    placeholderBaseCache.set(baseFile, first);
    return first;
  } catch {
    placeholderBaseCache.set(baseFile, null);
    return null;
  }
}

/** 绘制占位帧（无真实素材或加载失败），叠加在现有人形代表帧之上。 */
function paintPlaceholder(visualId: string, label: string, base: ImageData | null): void {
  timeline.ready(); // A failed reaction asset must still finish instead of locking future clicks.
  const image = compositePlaceholder(ctx, CANVAS_SIZE, visualId, label, base);
  lastCleanFrame = image;
  hitMask.update(image);
  lastDrawnFrame = -1;
}

function stopLoop(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** 动画循环：单调时钟驱动，整轮取模定位帧，无变化不重绘。 */
function loop(now: number): void {
  if (!animation || animation.frames.length === 0) return;
  if (reducedMotionNow) {
    if (lastDrawnFrame !== 0) {
      paintFrame(animation.frames[0].bitmap);
      lastDrawnFrame = 0;
    }
    return; // 不再调度，停在代表帧。
  }
  const { index } = frameAt(durations, now - loopStartedAt);
  if (index !== lastDrawnFrame) {
    paintFrame(animation.frames[index].bitmap);
    lastDrawnFrame = index;
    recheckHitAfterFrame();
  }
  rafId = requestAnimationFrame(loop);
}

/** 启动动画循环（供 controller 调用）。 */
function startLoop(anim: LoadedAnimation, reducedMotion: boolean): void {
  stopLoop();
  animation = anim;
  canvas.dataset.loadedVisual=renderedVisual;
  durations = anim.frames.map((f) => f.durationMs);
  reducedMotionNow = reducedMotion;
  timeline.ready();
  if (anim.frames.length === 0) return;
  if (reducedMotion) {
    paintFrame(anim.frames[0].bitmap);
    lastDrawnFrame = 0;
    return;
  }
  timeline.ready();
  loopStartedAt = performance.now() - timeline.current().offsetMs;
  lastDrawnFrame = -1;
  rafId = requestAnimationFrame(loop);
}

const controller = new PetController({
  resolveAsset: (visualId) => visualAssets.find((a) => a.visualId === visualId),
  loadAnimation: loadCached,
  loadPlaceholderBase,
  isSharedVisual,
  startLoop,
  stopLoop,
  paintPlaceholder,
  repaintOverlays,
  recheckHit: () => recheckHitAfterFrame(),
  cancelGesture: () => gestures.cancel()
});

function syncVisual(force = false): void {
  if(!sourceSnapshot) return;
  const selected=timeline.current();
  const visualId='a'+selected.id;
  // Timeline clock continues through interactions; phase resumes instead of restarting.
  if(renderedVisual===visualId && selected.key===lastSelectionKey && !gestures.isArmed) {
    loopStartedAt=performance.now()-selected.offsetMs;
  }
  if(!force && selected.key===lastSelectionKey && lastSourceRevision===sourceSnapshot.revision) return;
  const sameVisual=renderedVisual===visualId;
  const keyChanged=lastSelectionKey!==selected.key;
  lastSelectionKey=selected.key;renderedVisual=visualId;lastSourceRevision=sourceSnapshot.revision;
  canvas.dataset.visual=visualId;
  canvas.dataset.reaction=String(selected.reaction);
  controller.onSnapshot({...sourceSnapshot,revision:++renderRevision,
    displayedSlot:{...sourceSnapshot.displayedSlot,visualId}});
  if(keyChanged && sameVisual && !gestures.isArmed && !sourceSnapshot.hidden){controller.freeze();controller.release();}
}
function onSnapshot(snapshot: RuntimeSnapshot): void {
  if(sourceSnapshot && snapshot.revision<sourceSnapshot.revision)return;
  sourceSnapshot=snapshot;
  timeline.update(snapshot);
  // Effective visibility may change without a coordinator revision (window show/lock).
  syncVisual(true);
}
const timelineTimer=window.setInterval(()=>{if(sourceSnapshot && !sourceSnapshot.hidden)syncVisual();},100);
window.addEventListener('beforeunload',()=>window.clearInterval(timelineTimer));

// --- 命中与穿透上报 ---

let lastHit: boolean | null = null;
let lastClientX = -1;
let lastClientY = -1;

function reportHit(hit: boolean): void {
  if (hit === lastHit) return; // 只在命中结果变化时发 IPC。
  lastHit = hit;
  window.companion.setPointerHit(hit);
}

/** 换帧 / 占位重绘后按最近指针位置复查命中（指针不动也要更新）。 */
function recheckHitAfterFrame(): void {
  if (gestures.isArmed) return; // 冻结期间保持接收，不改命中。
  if (lastClientX < 0) return;
  reportHit(hitTestClient(lastClientX, lastClientY));
}

function trackPointer(e: MouseEvent): void {
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  if (!gestures.isArmed) {
    reportHit(hitTestClient(e.clientX, e.clientY));
  }
}
canvas.addEventListener('pointermove', trackPointer);
// Electron 的 forward:true 保证 mousemove，部分版本不生成 pointermove。
canvas.addEventListener('mousemove', trackPointer);
window.addEventListener('resize', () => { lastHit = null; recheckHitAfterFrame(); });

canvas.addEventListener('pointerleave', () => {
  // armed（已按下待判定）或拖动中：保持接收，不因 pointerleave 松开或清命中。
  if (gestures.isArmed || gestures.isDragging) return;
  lastClientX = -1;
  lastClientY = -1;
  reportHit(false);
});

// --- 手势 ---

const gestures = new GestureHandler(canvas, {
  isHit: (cx, cy) => hitTestClient(cx, cy),
  onClick: () => { window.companion.showStatus(); if(timeline.click())syncVisual(); },
  onPress: (point) => {
    reportHit(true); // 拖动中保持接收鼠标。
    controller.freeze(); // 整段冻结画面与命中，作废进行中的加载。
    window.companion.beginDrag(point);
  },
  onDragMove: (point) => window.companion.moveDrag(point),
  onDragBegin: () => {},
  onDragEnd: () => {},
  onRelease: () => {
    window.companion.endDrag();
    controller.release(); // 应用缓存的最新目标或恢复当前动画。
    // 重算穿透：lastHit 置空强制下一次比较必定重发，避免主进程被永久锁在接收。
    lastHit = null;
    if (lastClientX >= 0) {
      reportHit(hitTestClient(lastClientX, lastClientY));
    } else {
      reportHit(false);
    }
  }
});

// 右键：仅命中角色处弹原生菜单，透明处不触发。
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!hitTestClient(e.clientX, e.clientY)) return;
  window.companion.openMenu();
});

// 窗口隐藏（visibilitychange）或失焦时取消进行中的手势，防止卡住接收状态。
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (gestures.isDragging || gestures.isArmed)) gestures.cancel();
});

// --- 启动 ---

async function init(): Promise<void> {
  // Internal 25-touch is available to the renderer but omitted from the numbered settings list.
  visualAssets = Object.values(VISUAL_ASSETS);
  window.companion.onSnapshot(onSnapshot);
  const snap = await window.companion.getSnapshot();
  onSnapshot(snap);
}

void init();
