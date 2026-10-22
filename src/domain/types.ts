// 共享领域类型：主进程、preload、渲染进程都从这里取类型，保证进程间消息结构一致。

/** 单个作息时段。区间统一采用 [startMinute, endMinute)（含开始、不含结束）。 */
export type ScheduleSlot = {
  /** 稳定的活动标识，用于逻辑判断与持久化，不展示给用户。 */
  activityId: string;
  /** 中文显示名称，例如“听古典乐”。 */
  label: string;
  /** 气泡中的状态文字，例如“正在听古典乐”。 */
  statusText: string;
  /** 当天第几分钟开始，0–1440。 */
  startMinute: number;
  /** 当天第几分钟结束，0–1440；必须大于 startMinute。 */
  endMinute: number;
  /** 对应的视觉素材标识，由 AssetRegistry 解析。 */
  visualId: string;
};

/** 解析某一分钟得到的活动结论。 */
export type ActivityResolution = {
  current: ScheduleSlot;
  next: ScheduleSlot;
  /** 下一活动是否发生在次日（即当前为当天最后一段）。 */
  nextIsTomorrow: boolean;
  /** 下一活动的起始分钟（0–1440），用于生成“21:00 开始练拳”这类文案。 */
  nextStartMinute: number;
};

export type DisplayMode = 'realtime' | 'preview';

/**
 * 主进程发布的运行时状态快照。渲染进程启动时取完整快照，再订阅更新。
 * 每个快照带递增 revision；异步素材加载完成时比对 revision，过期素材不得覆盖新活动。
 */
export type RuntimeSnapshot = {
  revision: number;
  /** Main-process display clock: seconds since midnight. */
  displaySecond?: number;
  mode: DisplayMode;
  /** 预览分钟数（0–1439）；realtime 模式下为 null。 */
  previewMinute: number | null;
  /** 真实墙上时间解析出的活动标识。 */
  realActivityId: string;
  /** 当前应展示的活动标识（预览时为预览活动，否则等于真实活动）。 */
  displayedActivityId: string;
  /** 当前展示活动对应的时段（含显示名、状态文字、视觉 ID）。 */
  displayedSlot: ScheduleSlot;
  /** 下一活动时段。 */
  nextSlot: ScheduleSlot;
  nextIsTomorrow: boolean;
  nextStartMinute: number;
  hidden: boolean;
  reducedMotion: boolean;
};

/** 可持久化偏好。不保存当前活动、帧号、预览时间等运行期状态。 */
export type Preferences = {
  schemaVersion: number;
  /** 角色底部锚点的屏幕坐标（DIP）。null 表示尚未定位，首次放到主屏右下角。 */
  anchorX: number | null;
  anchorY: number | null;
  /** 上次所在显示器 id，用于恢复位置；显示器移除时回主屏。 */
  displayId: number | null;
  /** 角色显示高度（DIP），范围 96–240。 */
  characterHeight: number;
  alwaysOnTop: boolean;
  reducedMotion: boolean;
  /** 用户是否主动隐藏。首次默认 false（显示）。 */
  hidden: boolean;
};

export const CHARACTER_HEIGHT_MIN = 96;
export const CHARACTER_HEIGHT_MAX = 240;
export const CHARACTER_HEIGHT_DEFAULT = 160;
export const PREFERENCES_SCHEMA_VERSION = 1;
