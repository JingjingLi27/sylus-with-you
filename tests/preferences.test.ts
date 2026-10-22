import { describe, expect, it } from 'vitest';
import {
  defaultPreferences,
  sanitizePreferencePatch,
  sanitizePreferences,
  sanitizePreviewMinute
} from '../src/domain/preferences.js';
import {
  CHARACTER_HEIGHT_DEFAULT,
  CHARACTER_HEIGHT_MAX,
  CHARACTER_HEIGHT_MIN
} from '../src/domain/types.js';

describe('偏好默认值', () => {
  it('首次默认显示、置顶、不减少动态效果', () => {
    const p = defaultPreferences();
    expect(p.hidden).toBe(false);
    expect(p.alwaysOnTop).toBe(true);
    expect(p.reducedMotion).toBe(false);
    expect(p.characterHeight).toBe(CHARACTER_HEIGHT_DEFAULT);
    expect(p.anchorX).toBeNull();
  });
});

describe('偏好清洗', () => {
  it('损坏输入回退默认', () => {
    expect(sanitizePreferences(null)).toEqual(defaultPreferences());
    expect(sanitizePreferences('nonsense')).toEqual(defaultPreferences());
    expect(sanitizePreferences(42)).toEqual(defaultPreferences());
  });

  it('高度越界被夹紧到范围内', () => {
    expect(sanitizePreferences({ characterHeight: 10 }).characterHeight).toBe(
      CHARACTER_HEIGHT_MIN
    );
    expect(sanitizePreferences({ characterHeight: 9999 }).characterHeight).toBe(
      CHARACTER_HEIGHT_MAX
    );
    expect(sanitizePreferences({ characterHeight: 160.7 }).characterHeight).toBe(161);
  });

  it('锚点必须成对，单独一个被置空', () => {
    const p = sanitizePreferences({ anchorX: 100 });
    expect(p.anchorX).toBeNull();
    expect(p.anchorY).toBeNull();
    const q = sanitizePreferences({ anchorX: 100, anchorY: 200 });
    expect(q.anchorX).toBe(100);
    expect(q.anchorY).toBe(200);
  });

  it('非整数 displayId 被置空', () => {
    expect(sanitizePreferences({ displayId: 1.5 }).displayId).toBeNull();
    expect(sanitizePreferences({ displayId: 7 }).displayId).toBe(7);
  });

  it('布尔字段非布尔时回退默认', () => {
    expect(sanitizePreferences({ hidden: 'yes' }).hidden).toBe(false);
    expect(sanitizePreferences({ alwaysOnTop: 0 }).alwaysOnTop).toBe(true);
  });
});

describe('偏好补丁白名单', () => {
  it('只接受白名单字段', () => {
    const patch = sanitizePreferencePatch({
      characterHeight: 200,
      hidden: true,
      anchorX: 999,
      evil: 'rm -rf'
    });
    expect(patch).toEqual({ characterHeight: 200, hidden: true });
    expect('anchorX' in patch).toBe(false);
    expect('evil' in patch).toBe(false);
  });

  it('非法类型字段被丢弃', () => {
    const patch = sanitizePreferencePatch({ characterHeight: 'big', reducedMotion: 1 });
    expect(patch).toEqual({});
  });

  it('非对象输入返回空补丁', () => {
    expect(sanitizePreferencePatch(null)).toEqual({});
    expect(sanitizePreferencePatch('x')).toEqual({});
  });
});

describe('预览分钟校验', () => {
  it('只接受 0–1439 整数', () => {
    expect(sanitizePreviewMinute(0)).toBe(0);
    expect(sanitizePreviewMinute(1439)).toBe(1439);
    expect(sanitizePreviewMinute(720)).toBe(720);
  });

  it('越界或非整数返回 null', () => {
    expect(sanitizePreviewMinute(-1)).toBeNull();
    expect(sanitizePreviewMinute(1440)).toBeNull();
    expect(sanitizePreviewMinute(12.5)).toBeNull();
    expect(sanitizePreviewMinute('12')).toBeNull();
    expect(sanitizePreviewMinute(null)).toBeNull();
  });
});
