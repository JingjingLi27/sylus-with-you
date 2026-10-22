// 开发占位绘制：当某视觉无真实原画（sleep/wake/eat/wash）时，
// 以现有合适人形 GIF 的代表帧作为临时基础画面，叠加正确活动名与少量小道具，
// 使用户大多数时间仍看到已有秦彻形象。正式动作仍为“待补”（见设置素材说明）。
//
// 不生成/重画原始素材、不伪称有对应动作。无基础帧可用时退回极简人形剪影兜底。

export type PlaceholderSpec = {
  visualId: string;
  /** 轻量道具图标（emoji 级别），仅作区分，不代表正式美术。 */
  prop: string;
};

const SPECS: Record<string, PlaceholderSpec> = {
  sleep: { visualId: 'sleep', prop: 'Zzz' },
  wake: { visualId: 'wake', prop: '☀' },
  eat: { visualId: 'eat', prop: '🍚' },
  wash: { visualId: 'wash', prop: '💧' },
  idle: { visualId: 'idle', prop: '' }
};

/**
 * 在基础帧（现有人形代表帧，已缩放到画布）之上叠加道具与活动小标，返回合成后的 ImageData。
 * base 为 null 时退回简易剪影兜底。
 */
export function compositePlaceholder(
  ctx: CanvasRenderingContext2D,
  size: number,
  visualId: string,
  label: string,
  base: ImageData | null
): ImageData {
  const spec = SPECS[visualId] ?? SPECS.idle;
  ctx.clearRect(0, 0, size, size);

  if (base) {
    ctx.putImageData(base, 0, 0);
  } else {
    drawSilhouette(ctx, size);
  }

  const cx = size / 2;

  // 道具：画面右上角浮一个小标志，区分活动（睡觉 Zzz、起床 ☀、进食 🍚、洗漱 💧）。
  if (spec.prop) {
    ctx.fillStyle = '#7a1f2b';
    ctx.font = `${Math.round(size * 0.12)}px -apple-system, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.prop, size * 0.78, size * 0.2);
  }

  // 底部活动小标，带“待补”提示（克制、小字）。
  const padY = size * 0.055;
  const text = label;
  ctx.font = `${Math.round(size * 0.078)}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const chipW = Math.min(size * 0.9, metrics.width + size * 0.12);
  const chipH = size * 0.11;
  const chipX = cx - chipW / 2;
  const chipY = size - padY - chipH;
  roundRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
  ctx.fillStyle = 'rgba(122, 31, 43, 0.9)';
  ctx.fill();
  ctx.fillStyle = '#f6ece2';
  ctx.fillText(text, cx, chipY + chipH / 2);

  return ctx.getImageData(0, 0, size, size);
}

/** 无基础帧时的极简人形剪影兜底（仅在素材缺失时出现）。 */
function drawSilhouette(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2;
  const bottom = size * 0.9;
  const bodyH = size * 0.52;
  const bodyW = size * 0.3;
  const headR = size * 0.14;

  ctx.fillStyle = '#7a1f2b';
  roundRect(ctx, cx - bodyW / 2, bottom - bodyH, bodyW, bodyH - headR, size * 0.06);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, bottom - bodyH + headR * 0.4, headR, 0, Math.PI * 2);
  ctx.fillStyle = '#f6ece2';
  ctx.fill();

  ctx.fillStyle = '#b23a48';
  ctx.beginPath();
  ctx.arc(cx - headR * 0.35, bottom - bodyH + headR * 0.4, headR * 0.12, 0, Math.PI * 2);
  ctx.arc(cx + headR * 0.35, bottom - bodyH + headR * 0.4, headR * 0.12, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
