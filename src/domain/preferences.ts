// 偏好校验与迁移：纯逻辑，SettingsStore 读写磁盘时调用。
// 读入时验证类型与范围；损坏或越界字段回退默认值，不抛给上层。

import {
  CHARACTER_HEIGHT_DEFAULT,
  CHARACTER_HEIGHT_MAX,
  CHARACTER_HEIGHT_MIN,
  PREFERENCES_SCHEMA_VERSION,
  type Preferences
} from './types.js';

export function defaultPreferences(): Preferences {
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    anchorX: null,
    anchorY: null,
    displayId: null,
    characterHeight: CHARACTER_HEIGHT_DEFAULT,
    alwaysOnTop: true,
    reducedMotion: false,
    hidden: false
  };
}

function clampHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return CHARACTER_HEIGHT_DEFAULT;
  }
  return Math.min(CHARACTER_HEIGHT_MAX, Math.max(CHARACTER_HEIGHT_MIN, Math.round(value)));
}

function coerceNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function coerceNullableInt(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 把任意（可能损坏）的输入规整成合法 Preferences。
 * 永远返回可用对象，缺失或非法字段用默认值补齐。预留 schema 迁移点。
 */
export function sanitizePreferences(input: unknown): Preferences {
  const base = defaultPreferences();
  if (typeof input !== 'object' || input === null) {
    return base;
  }
  const raw = input as Record<string, unknown>;

  // schema 迁移：当前仅有 v1；未知版本按字段尽力解析，版本号归一到当前。
  const anchorX = coerceNullableNumber(raw.anchorX);
  const anchorY = coerceNullableNumber(raw.anchorY);
  // 锚点必须成对存在，否则一并置空以免半定位。
  const bothAnchors = anchorX !== null && anchorY !== null;

  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    anchorX: bothAnchors ? anchorX : null,
    anchorY: bothAnchors ? anchorY : null,
    displayId: coerceNullableInt(raw.displayId),
    characterHeight: clampHeight(raw.characterHeight),
    alwaysOnTop: coerceBool(raw.alwaysOnTop, base.alwaysOnTop),
    reducedMotion: coerceBool(raw.reducedMotion, base.reducedMotion),
    hidden: coerceBool(raw.hidden, base.hidden)
  };
}

/** 允许通过 IPC 更新的偏好字段白名单。 */
export type PreferencePatch = Partial<
  Pick<Preferences, 'characterHeight' | 'alwaysOnTop' | 'reducedMotion' | 'hidden'>
>;

/**
 * 校验并裁剪来自渲染进程的偏好补丁，只接受白名单字段与合法值。
 * 返回仅含合法字段的补丁；非法字段被丢弃。
 */
export function sanitizePreferencePatch(input: unknown): PreferencePatch {
  const patch: PreferencePatch = {};
  if (typeof input !== 'object' || input === null) {
    return patch;
  }
  const raw = input as Record<string, unknown>;

  if ('characterHeight' in raw && typeof raw.characterHeight === 'number') {
    patch.characterHeight = clampHeight(raw.characterHeight);
  }
  if ('alwaysOnTop' in raw && typeof raw.alwaysOnTop === 'boolean') {
    patch.alwaysOnTop = raw.alwaysOnTop;
  }
  if ('reducedMotion' in raw && typeof raw.reducedMotion === 'boolean') {
    patch.reducedMotion = raw.reducedMotion;
  }
  if ('hidden' in raw && typeof raw.hidden === 'boolean') {
    patch.hidden = raw.hidden;
  }
  return patch;
}

/**
 * 校验预览分钟输入：只接受 0–1439 的整数，否则返回 null（视为无效，不进入预览）。
 */
export function sanitizePreviewMinute(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isInteger(input)) {
    return null;
  }
  if (input < 0 || input > 1439) {
    return null;
  }
  return input;
}
