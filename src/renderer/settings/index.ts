// 设置窗渲染进程：九段作息预览、预览标识与回到现在、偏好（大小/置顶/减少动态效果/隐藏）、
// 预览不持久化；关闭窗口由主进程清预览。

import { formatClock } from '../../domain/schedule.js';
import type { Preferences, RuntimeSnapshot, ScheduleSlot } from '../../domain/types.js';
import {
  CHARACTER_HEIGHT_MAX,
  CHARACTER_HEIGHT_MIN
} from '../../domain/types.js';

const $ = (id: string) => document.getElementById(id)!;

let slots: ScheduleSlot[] = [];
let currentSnapshot: RuntimeSnapshot | null = null;

/** 安全创建带文本的 span，避免未验证文本拼 innerHTML。 */
function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text; // textContent 不解析 HTML，防注入。
  return el;
}

function renderSchedule(): void {
  const list = $('schedule-list');
  list.replaceChildren();
  for (const slot of slots) {
    const row = document.createElement('button');
    row.className = 'slot-row';
    row.type = 'button';
    row.dataset.start = String(slot.startMinute);
    const endClock = formatClock(slot.endMinute % 1440 === 0 ? 1440 : slot.endMinute);
    const time = `${formatClock(slot.startMinute)}–${endClock}`;
    row.append(
      span('slot-time', time),
      span('slot-label', slot.label)
    );
    row.addEventListener('click', () => {
      window.companion.setPreviewMinute(slot.startMinute);
    });
    list.appendChild(row);
  }
}

function renderPreferences(prefs: Preferences): void {
  const height = $('pref-height') as HTMLInputElement;
  height.min = String(CHARACTER_HEIGHT_MIN);
  height.max = String(CHARACTER_HEIGHT_MAX);
  height.value = String(prefs.characterHeight);
  ($('pref-height-value') as HTMLSpanElement).textContent = `${prefs.characterHeight} 像素`;
  ($('pref-ontop') as HTMLInputElement).checked = prefs.alwaysOnTop;
  ($('pref-reduced') as HTMLInputElement).checked = prefs.reducedMotion;
  ($('pref-hidden') as HTMLInputElement).checked = prefs.hidden;
}

function renderStatusBar(snapshot: RuntimeSnapshot): void {
  const bar = $('status-bar');
  const badge = $('preview-badge');
  const nowBtn = $('back-to-now') as HTMLButtonElement;

  // 高亮当前展示的时段。
  document.querySelectorAll('.slot-row').forEach((el) => {
    const row = el as HTMLElement;
    const start = Number(row.dataset.start);
    row.classList.toggle('active', start === snapshot.displayedSlot.startMinute);
    row.classList.toggle(
      'real-active',
      snapshot.mode === 'realtime' && start === snapshot.displayedSlot.startMinute
    );
  });

  if (snapshot.mode === 'preview') {
    badge.classList.add('visible');
    badge.textContent = `预览中 · ${snapshot.displayedSlot.label}（真实时间为「${realLabel(snapshot)}」）`;
    nowBtn.disabled = false;
    bar.classList.add('previewing');
  } else {
    badge.classList.remove('visible');
    badge.textContent = '';
    nowBtn.disabled = true;
    bar.classList.remove('previewing');
  }
  ($('status-text') as HTMLSpanElement).textContent = snapshot.displayedSlot.statusText;
}

function realLabel(snapshot: RuntimeSnapshot): string {
  const real = slots.find((s) => s.activityId === snapshot.realActivityId);
  return real?.label ?? snapshot.realActivityId;
}

function wirePreferences(): void {
  const height = $('pref-height') as HTMLInputElement;
  height.addEventListener('input', () => {
    ($('pref-height-value') as HTMLSpanElement).textContent = `${height.value} 像素`;
  });
  height.addEventListener('change', () => {
    window.companion.updatePreferences({ characterHeight: Number(height.value) });
  });
  ($('pref-ontop') as HTMLInputElement).addEventListener('change', (e) => {
    window.companion.updatePreferences({ alwaysOnTop: (e.target as HTMLInputElement).checked });
  });
  ($('pref-reduced') as HTMLInputElement).addEventListener('change', (e) => {
    window.companion.updatePreferences({ reducedMotion: (e.target as HTMLInputElement).checked });
  });
  ($('pref-hidden') as HTMLInputElement).addEventListener('change', (e) => {
    window.companion.updatePreferences({ hidden: (e.target as HTMLInputElement).checked });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-preview-minute]').forEach(button => {
    button.addEventListener('click',()=>window.companion.setPreviewMinute(Number(button.dataset.previewMinute)));
  });
  ($('back-to-now') as HTMLButtonElement).addEventListener('click', () => {
    window.companion.clearPreview();
  });
}

function onSnapshot(snapshot: RuntimeSnapshot): void {
  currentSnapshot = snapshot;
  renderStatusBar(snapshot);
  ($('pref-reduced') as HTMLInputElement).checked = snapshot.reducedMotion;
  ($('pref-hidden') as HTMLInputElement).checked = snapshot.hidden;
  // 大小/置顶可能由右键或菜单栏改动；重新拉取偏好同步控件（防抖避免频繁拉取）。
  schedulePrefsRefresh();
}

let prefsRefreshTimer = 0;
function schedulePrefsRefresh(): void {
  if (prefsRefreshTimer) return;
  prefsRefreshTimer = window.setTimeout(() => {
    prefsRefreshTimer = 0;
    void window.companion.getPreferences().then((prefs) => {
      // 用户正在拖动滑块时不要打断：仅在未聚焦该控件时覆盖。
      const height = $('pref-height') as HTMLInputElement;
      if (document.activeElement !== height) {
        height.value = String(prefs.characterHeight);
        ($('pref-height-value') as HTMLSpanElement).textContent = `${prefs.characterHeight} 像素`;
      }
      ($('pref-ontop') as HTMLInputElement).checked = prefs.alwaysOnTop;
    });
  }, 150);
}

async function init(): Promise<void> {
  const [prefs, loadedSlots] = await Promise.all([
    window.companion.getPreferences(),
    window.companion.getScheduleSlots()
  ]);
  slots = loadedSlots;
  renderSchedule();
  renderPreferences(prefs);
  wirePreferences();

  window.companion.onSnapshot(onSnapshot);
  const snap = await window.companion.getSnapshot();
  onSnapshot(snap);

  // 关闭窗口前清除预览由主进程在窗口关闭事件处理；此处在卸载时也主动清一次。
  window.addEventListener('beforeunload', () => {
    if (currentSnapshot?.mode === 'preview') window.companion.clearPreview();
  });
}

void init();
