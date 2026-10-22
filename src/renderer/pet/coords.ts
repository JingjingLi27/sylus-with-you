// 纯坐标换算：把 client/DIP 坐标映射到固定运行画布（512）像素坐标。
// 角色窗画布缓冲为固定 CANVAS_SIZE，由 CSS 缩放到窗口 DIP 尺寸（96/160/240 等）。
// 命中测试在画布像素空间进行，因此所有 client 坐标都要先经本函数换算，
// 保证不同窗口尺寸下点击位置一致。抽成纯函数便于按多种尺寸做回归测试，不依赖 DOM。

export type RectLike = { left: number; top: number; width: number; height: number };

/**
 * 把 client 坐标换算为画布像素坐标。
 * @param clientX 事件 clientX（相对视口，DIP）
 * @param clientY 事件 clientY
 * @param rect    画布元素的 getBoundingClientRect（DIP 尺寸，等于窗口 CSS 尺寸）
 * @param canvasSize 画布缓冲边长（像素，固定 512）
 * 宽或高为 0（未布局）时返回 {-1,-1} 视为无效。
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: RectLike,
  canvasSize: number
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: -1, y: -1 };
  return {
    x: ((clientX - rect.left) / rect.width) * canvasSize,
    y: ((clientY - rect.top) / rect.height) * canvasSize
  };
}
