// 当前帧透明度掩码：鼠标位置查当前帧 alpha，判断是否命中角色/道具（非透明）。
// 掩码随当前帧更新；即使鼠标不动，换帧后也必须重算命中。掩码由一维 alpha 数组表示，
// 以画布像素为单位，避免每次鼠标移动都读大画布。

const ALPHA_THRESHOLD = 16; // alpha 低于此值视为透明（未命中）。

export class HitMask {
  private alpha: Uint8ClampedArray | null = null;

  /** 用当前帧 ImageData 更新掩码。只保留 alpha 通道，降低内存与查表成本。 */
  update(frame: ImageData): void {
    const { data, width, height } = frame;
    const n = width * height;
    if (!this.alpha || this.alpha.length !== n) {
      this.alpha = new Uint8ClampedArray(n);
    }
    for (let i = 0; i < n; i += 1) {
      this.alpha[i] = data[i * 4 + 3];
    }
    this.width = width;
    this.height = height;
  }

  private width = 0;
  private height = 0;

  /**
   * 判断画布坐标 (x, y) 是否命中非透明像素。
   * 坐标超出画布视为未命中。
   */
  hitTest(x: number, y: number): boolean {
    if (!this.alpha) return false;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    return this.alpha[py * this.width + px] > ALPHA_THRESHOLD;
  }

  get ready(): boolean {
    return this.alpha !== null;
  }
}
