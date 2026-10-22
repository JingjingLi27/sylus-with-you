// 主进程入口：单实例、生命周期、菜单栏(Tray)、原生右键菜单、powerMonitor 校准，
// 将协调器、窗口、设置、IPC 接到一起。主进程是状态唯一来源。

import { app, Menu, Tray, nativeImage, powerMonitor, screen, type MenuItemConstructorOptions } from 'electron';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StateCoordinator } from './coordinator.js';
import { WindowManager } from './windows.js';
import { SettingsStore } from './settings.js';
import { loadSchedule } from './schedule-loader.js';
import { registerIpc } from './ipc.js';
import {
  ASSET_SCHEME,
  registerAssetProtocol,
  registerAssetSchemePrivileges
} from './assets-protocol.js';
import { buildBubbleText } from '../domain/state.js';
import { allPosesHaveRealArt } from '../domain/assets.js';
import type { PreferencePatch } from '../domain/preferences.js';
import { CH } from '../shared/channels.js';
import type { RuntimeManifest } from '../shared/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(here, '../../assets/runtime');

// 测试模式：仅在明确设置环境变量时启用，便于 Codex 注入时钟与临时 userData。
// 不改变系统时钟。QINCHE_TEST_NOW=分钟数(0-1439) 或 ISO 时间；QINCHE_USER_DATA=临时目录。
const TEST_NOW = process.env.QINCHE_TEST_NOW;
const TEST_USER_DATA = process.env.QINCHE_USER_DATA;

if (TEST_USER_DATA) {
  app.setPath('userData', TEST_USER_DATA);
}

if (process.platform === 'win32') app.setAppUserModelId('com.qinche.companion');

registerAssetSchemePrivileges();

// 单实例：防止多只角色。未拿到锁必须直接退出，绝不继续 bootstrap（否则两只角色同时跑）。
const gotLock = app.requestSingleInstanceLock();

let tray: Tray | null = null;
let coordinator: StateCoordinator;
let windows: WindowManager;
let settings: SettingsStore;
let cleanupIpc: (() => void) | null = null;

// 系统挂起与锁屏分别记录，避免“挂起+锁屏”重叠时，仅解锁却还在挂起（或反之）就恢复显示。
// 二者独立于用户主动隐藏（settings.hidden），都不写入偏好。
let systemSuspended = false;
let screenLocked = false;

function makeClock(): () => Date {
  if (!TEST_NOW) return () => new Date();
  // 注入固定时钟：数字按当天分钟，字符串按 ISO 解析。
  const asNumber = Number(TEST_NOW);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber <= 1439) {
    return () => {
      const d = new Date();
      d.setHours(Math.floor(asNumber / 60), asNumber % 60, 0, 0);
      return d;
    };
  }
  const fixed = new Date(TEST_NOW);
  if (!Number.isNaN(fixed.getTime())) return () => fixed;
  return () => new Date();
}

async function loadManifest(): Promise<RuntimeManifest> {
  try {
    const raw = await readFile(join(RUNTIME_DIR, 'manifest.json'), 'utf8');
    return JSON.parse(raw) as RuntimeManifest;
  } catch {
    return {
      schemaVersion: 1,
      generatedAt: '',
      note: '运行素材清单缺失，使用占位。请先执行 npm run build。',
      gifs: [],
      missing: ['manifest.json']
    };
  }
}

let lastBroadcastActivity = '';

function broadcastSnapshot(): void {
  const base = coordinator.getSnapshot();
  // 下发给渲染进程的有效隐藏 = 用户主动隐藏 或 系统挂起/锁屏。
  // 系统挂起不写入用户偏好，只在快照里对渲染进程表现为隐藏，用来暂停动画。
  const effectiveHidden = windows.isEffectivelyHidden();
  const snap = effectiveHidden === base.hidden ? base : { ...base, hidden: effectiveHidden };
  // 活动变更或（有效）隐藏时关闭残留气泡，避免旧状态文字停留。
  if (snap.displayedActivityId !== lastBroadcastActivity || snap.hidden) {
    windows.dismissBubble();
    lastBroadcastActivity = snap.displayedActivityId;
  }
  const pet = windows.getPet();
  if (pet && !pet.isDestroyed()) pet.webContents.send(CH.snapshot, snap);
  const set = windows.getSettings();
  if (set && !set.isDestroyed()) set.webContents.send(CH.snapshot, snap);
}

function showStatusBubble(): void {
  const text = buildBubbleText(coordinator.getSnapshot());
  windows.showBubble(text, 5000);
}

function buildContextMenu(): Menu {
  const prefs = settings.get();
  const template: MenuItemConstructorOptions[] = [
    { label: '看看今天的作息', click: () => windows.createOrShowSettings() },
    {
      label: '大小',
      submenu: [
        { label: '小 (96)', type: 'radio', checked: prefs.characterHeight <= 112, click: () => applyPreferences({ characterHeight: 96 }) },
        { label: '中 (160)', type: 'radio', checked: prefs.characterHeight > 112 && prefs.characterHeight < 208, click: () => applyPreferences({ characterHeight: 160 }) },
        { label: '大 (240)', type: 'radio', checked: prefs.characterHeight >= 208, click: () => applyPreferences({ characterHeight: 240 }) }
      ]
    },
    { label: '始终置顶', type: 'checkbox', checked: prefs.alwaysOnTop, click: (mi) => applyPreferences({ alwaysOnTop: mi.checked }) },
    { label: '减少动态效果', type: 'checkbox', checked: prefs.reducedMotion, click: (mi) => applyPreferences({ reducedMotion: mi.checked }) },
    { type: 'separator' },
    { label: '回到主屏', click: () => { windows.moveToPrimary(); persistAnchor(); } },
    { label: '隐藏', click: () => applyPreferences({ hidden: true }) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ];
  return Menu.buildFromTemplate(template);
}

function openContextMenu(): void {
  const pet = windows.getPet();
  if (pet && !pet.isDestroyed()) buildContextMenu().popup({ window: pet });
}

function buildTrayMenu(): Menu {
  const prefs = settings.get();
  return Menu.buildFromTemplate([
    {
      label: prefs.hidden ? '显示秦彻' : '隐藏秦彻',
      click: () => applyPreferences({ hidden: !settings.get().hidden })
    },
    { label: '设置 / 今天的作息', click: () => windows.createOrShowSettings() },
    { label: '回到主屏', click: () => { windows.moveToPrimary(); persistAnchor(); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}

function refreshTray(): void {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function persistAnchor(): void {
  const anchor = windows.currentAnchor();
  if (anchor) {
    settings.update({ anchorX: anchor.anchorX, anchorY: anchor.anchorY, displayId: anchor.displayId });
  }
}

/** 偏好变更的统一入口：写盘 + 同步窗口与协调器 + 刷新菜单。 */
function applyPreferences(patch: PreferencePatch): void {
  const updated = settings.update(patch);
  if ('alwaysOnTop' in patch && typeof patch.alwaysOnTop === 'boolean') {
    windows.setAlwaysOnTop(patch.alwaysOnTop);
  }
  if ('characterHeight' in patch && typeof patch.characterHeight === 'number') {
    windows.setCharacterHeight(updated.characterHeight);
    persistAnchor();
  }
  if ('reducedMotion' in patch && typeof patch.reducedMotion === 'boolean') {
    coordinator.setReducedMotion(patch.reducedMotion);
  }
  if ('hidden' in patch && typeof patch.hidden === 'boolean') {
    coordinator.setHidden(patch.hidden);
    if (patch.hidden) {
      windows.hidePet(); // = setUserHidden(true)
      coordinator.stop(); // 隐藏时停止每秒刷新。
    } else {
      windows.showPet(); // = setUserHidden(false)；若系统仍挂起则 WindowManager 内部保持隐藏。
      // 系统挂起/锁屏期间不恢复每秒刷新，待 resume/unlock 统一恢复，避免挂起期空转。
      if (!systemSuspended && !screenLocked) coordinator.start();
    }
  }
  refreshTray();
  broadcastSnapshot();
}

function createTray(): void {
  // macOS 保留文字入口；Windows 必须提供可见图标，才能在隐藏角色后找回。
  const image = process.platform === 'darwin'
    ? nativeImage.createEmpty()
    : nativeImage.createFromPath(join(here, '../../assets/icons/qinche.png')).resize({ width: 32, height: 32 });
  tray = new Tray(image);
  if (process.platform === 'darwin') tray.setTitle('秦彻');
  if (process.platform === 'win32') tray.on('click', () => windows.createOrShowSettings());
  tray.setToolTip('秦彻陪伴');
  tray.setContextMenu(buildTrayMenu());
}

async function bootstrap(): Promise<void> {
  registerAssetProtocol();

  settings = new SettingsStore();
  await settings.load();

  const { slots, usedDefault } = await loadSchedule();
  if (usedDefault) console.warn('[main] 使用内置默认作息表');
  if (!allPosesHaveRealArt()) {
    console.warn('[main] 部分姿态为开发占位，未满足正式全部姿态验收（见设置素材状态）。');
  }

  const manifest = await loadManifest();

  coordinator = new StateCoordinator(slots, makeClock());
  // 把持久化偏好种入协调器，使重启后设置界面与实际动画一致（减少动态效果 / 隐藏）。
  const initialPrefs = settings.get();
  coordinator.setReducedMotion(initialPrefs.reducedMotion);
  coordinator.setHidden(initialPrefs.hidden);
  windows = new WindowManager(initialPrefs);

  cleanupIpc = registerIpc({
    coordinator,
    windows,
    settings,
    slots,
    manifest,
    applyPreferences,
    onShowStatus: showStatusBubble,
    onOpenMenu: openContextMenu,
    onEndDrag: () => {
      const anchor = windows.endDrag();
      if (anchor) {
        settings.update({
          anchorX: anchor.anchorX,
          anchorY: anchor.anchorY,
          displayId: anchor.displayId
        });
      }
    },
    onBubbleReady: () => windows.markBubbleReady()
  });

  // 协调器更新即广播到各窗口。
  coordinator.subscribe(() => broadcastSnapshot());

  // 设置窗关闭（含异常退出）即清除预览、恢复实时。
  windows.setOnSettingsClosed(() => {
    if (coordinator.isPreviewing()) coordinator.clearPreview();
  });

  // 角色渲染进程崩溃：销毁旧角色窗；若非主动隐藏则重建，重建后重新种入快照。
  // 菜单栏“显示秦彻”也能再次拉起（通过 applyPreferences({ hidden: false })）。
  windows.setOnPetGone(() => {
    // 角色窗没了，残留气泡必须一并清理（否则气泡悬在原处且无主）。
    windows.dismissBubble();
    windows.destroyPet();
    // 仅当用户未主动隐藏时重建；系统挂起期间重建后仍会按有效隐藏保持隐藏。
    if (!settings.get().hidden) {
      windows.createPetWindow();
      coordinator.recompute();
      broadcastSnapshot();
    }
  });

  windows.createPetWindow();
  createTray();

  // 首次若偏好为隐藏，则不启动刷新；否则开始每秒重算。
  if (settings.get().hidden) {
    windows.hidePet();
  } else {
    coordinator.start();
  }

  // 锁屏 / 休眠：暂停每秒显示刷新（逻辑作息不暂停），并给渲染进程下发有效隐藏=true、
  // 隐藏角色窗以停住动画；但绝不写入用户 hidden 偏好。
  // 恢复：仅当挂起与锁屏都已解除时才真正恢复——先按墙上时间校准，再按用户 hidden 决定显隐与刷新。
  const applySystemGate = (): void => {
    const suspended = systemSuspended || screenLocked;
    windows.setSystemSuspended(suspended);
    // 渲染进程据有效隐藏暂停/恢复动画（用户 hidden 或系统挂起任一为真即暂停）。
    broadcastSnapshot();
  };
  const enterSuspend = (): void => {
    systemSuspended = true;
    coordinator.stop();
    applySystemGate();
  };
  const enterLock = (): void => {
    screenLocked = true;
    coordinator.stop();
    applySystemGate();
  };
  const leaveSuspend = (): void => {
    systemSuspended = false;
    maybeResumeSystem();
  };
  const leaveLock = (): void => {
    screenLocked = false;
    maybeResumeSystem();
  };
  const maybeResumeSystem = (): void => {
    // 仍有任一挂起来源未解除：保持暂停与隐藏，不恢复（避免解锁却还在休眠就亮窗）。
    if (systemSuspended || screenLocked) {
      applySystemGate();
      return;
    }
    coordinator.recompute(); // 恢复前先按当前墙上时间校准。
    windows.setSystemSuspended(false); // 解除系统隐藏，按用户 hidden 决定实际显隐。
    if (!settings.get().hidden) coordinator.start();
    broadcastSnapshot();
  };
  powerMonitor.on('suspend', enterSuspend);
  powerMonitor.on('lock-screen', enterLock);
  powerMonitor.on('resume', leaveSuspend);
  powerMonitor.on('unlock-screen', leaveLock);

  screen.on('display-removed', () => { windows.handleDisplaysChanged(); persistAnchor(); });
  screen.on('display-metrics-changed', () => { windows.handleDisplaysChanged(); persistAnchor(); });
}

app.on('second-instance', () => {
  // 第二个实例启动时，把已有角色显示出来。
  if (windows) {
    applyPreferences({ hidden: false });
  }
});

// 只有拿到单实例锁才启动；否则立即退出，绝不 bootstrap。
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[main] 启动失败', err);
    app.quit();
  });
}

// macOS 桌宠：关闭所有窗口不退出（仍驻留菜单栏）。
app.on('window-all-closed', () => {
  // 不自动退出；通过菜单栏退出。
});

let quitting = false;
app.on('before-quit', (e) => {
  // 没有 settings（极早期退出）直接放行。
  if (!settings) return;
  // 已在收尾：不再拦截，让真正的退出继续（防重入导致永不退出）。
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  // 退出前完成待写入的偏好；无论成功或异常，finally 都保证进程退出，不卡死。
  void (async () => {
    try {
      persistAnchor();
      await settings.flush();
    } catch (err) {
      console.error('[main] 退出前收尾失败', err);
    } finally {
      cleanupIpc?.();
      process.nextTick(() => app.exit(0));
    }
  })();
});

// 导出便于类型检查引用（避免 unused 文件告警）；ASSET_SCHEME 供诊断。
export { ASSET_SCHEME };
