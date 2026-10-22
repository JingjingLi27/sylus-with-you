// GIF 播放器：用 gifuct-js 解码透明 GIF，按 disposal 合成完整帧，等比缩小到运行画布。
// 保留每帧原时长，用单调时钟（performance.now）调度，错过帧直接前进，不补播积压帧。
// 只解码当前素材；切换时释放旧帧与定时器。减少动态效果时停在代表帧、停止循环。

import { decompressFrames, parseGIF } from 'gifuct-js';

export type DecodedFrame = {
  // 合成后的完整帧（已按 disposal 处理），尺寸为统一运行画布。
  bitmap: ImageData;
  durationMs: number;
};

export type LoadedAnimation = {
  frames: DecodedFrame[];
  width: number;
  height: number;
  totalDurationMs: number;
};

/**
 * 解码并把 GIF 合成为统一画布的帧序列。
 * @param url 素材 URL（qinche-asset://...）
 * @param canvasSize 运行画布边长（正方形），帧将等比缩放并居中、底部锚定。
 */
export async function loadGifAnimation(url: string, canvasSize: number): Promise<LoadedAnimation> {
  const buf = await (await fetch(url)).arrayBuffer();
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true); // buildImagePatch=true，得到 RGBA patch
  if (raw.length === 0) throw new Error('GIF 无帧');

  const logicalW = gif.lsd.width;
  const logicalH = gif.lsd.height;

  // 合成用的全尺寸离屏画布（GIF 逻辑尺寸），逐帧按 disposal 叠加。
  const full = document.createElement('canvas');
  full.width = logicalW;
  full.height = logicalH;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  if (!fctx) throw new Error('无法创建合成上下文');

  // 缩放目标：等比缩放使高度贴近画布的 ~80%，底部锚定、水平居中。
  const scale = (canvasSize * 0.8) / logicalH;
  const drawW = Math.round(logicalW * scale);
  const drawH = Math.round(logicalH * scale);
  const offsetX = Math.round((canvasSize - drawW) / 2);
  const offsetY = Math.round(canvasSize - drawH - canvasSize * 0.1); // 底部留 10% 余量

  const out = document.createElement('canvas');
  out.width = canvasSize;
  out.height = canvasSize;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('无法创建输出上下文');

  const frames: DecodedFrame[] = [];
  let prevImageData: ImageData | null = null;

  for (const frame of raw) {
    const { dims, disposalType, patch, delay } = frame;

    // disposal=3：恢复到绘制前状态。先保存当前区域。
    if (disposalType === 3) {
      prevImageData = fctx.getImageData(0, 0, logicalW, logicalH);
    }

    // 把本帧 patch 绘到合成画布的 dims 位置。
    const patchData = new ImageData(new Uint8ClampedArray(patch), dims.width, dims.height);
    const tmp = document.createElement('canvas');
    tmp.width = dims.width;
    tmp.height = dims.height;
    tmp.getContext('2d')!.putImageData(patchData, 0, 0);
    fctx.drawImage(tmp, dims.left, dims.top);

    // 把合成结果等比缩放绘入输出画布。
    octx.clearRect(0, 0, canvasSize, canvasSize);
    octx.drawImage(full, offsetX, offsetY, drawW, drawH);
    // gifuct-js 已把 delay 转为毫秒（见 lib/index.js: delay = (gce.delay||10)*10）。
    // 这里不要再 *10，否则整轮时长会被放大十倍。缺省/过小按 100ms 兜底。
    const durationMs = typeof delay === 'number' && delay > 0 ? delay : 100;
    frames.push({
      bitmap: octx.getImageData(0, 0, canvasSize, canvasSize),
      durationMs: Math.max(20, durationMs)
    });

    // 处理 disposal：2=清除本帧区域为背景（透明）；3=恢复到之前；其它=保留。
    if (disposalType === 2) {
      fctx.clearRect(dims.left, dims.top, dims.width, dims.height);
    } else if (disposalType === 3 && prevImageData) {
      fctx.putImageData(prevImageData, 0, 0);
    }
  }

  const totalDurationMs = frames.reduce((s, f) => s + f.durationMs, 0);
  return { frames, width: canvasSize, height: canvasSize, totalDurationMs };
}
