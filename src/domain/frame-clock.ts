// 纯帧调度计算：给定每帧时长与从循环起点到现在的经过毫秒，算出当前应显示的帧索引
// 以及该帧已播放的毫秒。先对整轮总时长取模，避免长时间睡眠后产生巨大的逐帧前进循环。
// 不依赖 DOM，便于测试。

export type FrameTiming = {
  index: number;
  /** 该帧已播放的毫秒（0 ≤ offset < 该帧时长）。 */
  offsetMs: number;
};

/**
 * @param durationsMs 每帧时长（毫秒），长度 ≥ 1，均为正数。
 * @param elapsedMs 从循环起点到现在的经过毫秒（可以非常大，如睡眠数小时）。
 */
export function frameAt(durationsMs: number[], elapsedMs: number): FrameTiming {
  if (durationsMs.length === 0) {
    return { index: 0, offsetMs: 0 };
  }
  const total = durationsMs.reduce((s, d) => s + d, 0);
  if (total <= 0) {
    return { index: 0, offsetMs: 0 };
  }
  // 先取模到一轮之内，避免逐帧 while 累加遍历海量轮次。
  let remainder = elapsedMs % total;
  if (remainder < 0) remainder += total;
  let index = 0;
  while (remainder >= durationsMs[index]) {
    remainder -= durationsMs[index];
    index = (index + 1) % durationsMs.length;
  }
  return { index, offsetMs: remainder };
}
