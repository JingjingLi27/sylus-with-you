// 手势处理：区分点击与拖动。移动超过阈值才算拖动；拖动用 pointer capture 锁定接收，
// pointercancel / 失去捕获时安全结束。结束拖动不再弹点击气泡。
// 不使用整窗系统拖动区——只有命中角色的 pointerdown 才可能开始手势。

const DRAG_THRESHOLD_DIP = 4;

export type GestureCallbacks = {
  /** 命中角色且按下时询问是否命中（命中才允许开始手势）。入参为 client 坐标。 */
  isHit: (clientX: number, clientY: number) => boolean;
  onPress?: (point: {x: number; y: number}) => void;
  onRelease?: () => void;
  onClick: () => void;
  onDragBegin: () => void;
  onDragMove: (point: {x: number; y: number}) => void;
  onDragEnd: () => void;
};

export class GestureHandler {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private dragging = false;
  private armed = false; // 已在角色上按下，等待判定点击或拖动。

  constructor(
    private readonly target: HTMLElement,
    private readonly cb: GestureCallbacks
  ) {
    this.target.addEventListener('pointerdown', this.onPointerDown);
    this.target.addEventListener('pointermove', this.onPointerMove);
    this.target.addEventListener('pointerup', this.onPointerUp);
    this.target.addEventListener('pointercancel', this.onPointerCancel);
    // 丢失指针捕获时安全收尾。
    this.target.addEventListener('lostpointercapture', this.onLostCapture);
  }

  private onPointerDown = (e: PointerEvent): void => {
    // 仅主键、且命中角色时才接管手势。用 client 坐标，由上层换算到画布像素。
    if (e.button !== 0 || this.armed) return;
    if (!this.cb.isHit(e.clientX, e.clientY)) return;
    this.pointerId = e.pointerId;
    this.startX = e.screenX;
    this.startY = e.screenY;
    this.dragging = false;
    this.armed = true;
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      this.armed = false;
      this.pointerId = null;
      return;
    }
    this.cb.onPress?.({x:e.screenX,y:e.screenY});
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.armed || e.pointerId !== this.pointerId) return;
    const dx = e.screenX - this.startX;
    const dy = e.screenY - this.startY;
    if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_DIP) {
      this.dragging = true;
      this.cb.onDragBegin();
    }
    if (this.dragging) {
      this.cb.onDragMove({x:e.screenX,y:e.screenY});
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const wasDragging = this.dragging;
    this.release(e.pointerId);
    if (wasDragging) {
      this.cb.onDragEnd();
    } else {
      // 未达拖动阈值 → 视为点击。
      this.cb.onClick();
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const wasDragging = this.dragging;
    this.release(e.pointerId);
    if (wasDragging) this.cb.onDragEnd();
    // pointercancel 不触发点击。
  };

  private onLostCapture = (): void => {
    if (!this.armed) return;
    const wasDragging = this.dragging;
    this.armed = false;
    this.dragging = false;
    this.pointerId = null;
    if (wasDragging) this.cb.onDragEnd();
    this.cb.onRelease?.();
  };

  private release(pointerId: number): void {
    this.armed = false;
    this.dragging = false;
    this.pointerId = null;
    try {
      this.target.releasePointerCapture(pointerId);
    } catch {
      /* 可能已释放，忽略 */
    }
    this.cb.onRelease?.();
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** 外部强制取消手势（窗口隐藏、失去捕获、渲染异常时清理会话）。 */
  cancel(): void {
    const wasArmed = this.armed;
    const wasDragging = this.dragging;
    const id = this.pointerId;
    this.armed = false;
    this.dragging = false;
    this.pointerId = null;
    if (id !== null) {
      try {
        this.target.releasePointerCapture(id);
      } catch {
        /* 忽略 */
      }
    }
    if (wasDragging) this.cb.onDragEnd();
    if (wasArmed) this.cb.onRelease?.();
  }

  dispose(): void {
    this.cancel();
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerCancel);
    this.target.removeEventListener('lostpointercapture', this.onLostCapture);
  }
}
