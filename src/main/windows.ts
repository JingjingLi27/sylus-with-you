// WindowManager：创建与管理角色窗、气泡窗、设置窗；处理置顶、尺寸、点击穿透、
// 拖动会话与多显示器位置恢复。不决定角色此刻该做什么（那是协调器的职责）。

import {
  BrowserWindow,
  screen,
  type Display,
  type WebContents,
  type WebFrameMain
} from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CHARACTER_HEIGHT_DEFAULT,
  type Preferences
} from '../domain/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(here, '../preload/index.cjs');
const RENDERER = join(here, '../renderer');

type Role = 'pet' | 'bubble' | 'settings';

// 每个角色窗绑定一个精确的本地页面 URL（file://，由 pathToFileURL 规整编码）。
// 导航校验与可信发送者校验都以这些精确值为准，不接受任何其它 file:// 或远程地址。
const ROLE_URL: Record<Role, string> = {
  pet: pathToFileURL(join(RENDERER, 'pet/index.html')).toString(),
  bubble: pathToFileURL(join(RENDERER, 'bubble/index.html')).toString(),
  settings: pathToFileURL(join(RENDERER, 'settings/index.html')).toString()
};

// 把窗口严格锁死在它自己的本地页面：
// - 任何导航/重定向目标不等于该窗口的精确 URL 一律拒绝（含 http/https/about:/其它 file://）。
// - 一律禁止新开窗口，且不把链接交给系统浏览器（无 shell 外开副作用）。
// - 禁止 <webview>，拒绝全部权限请求。
// 这样即便渲染进程被注入，也只能停留在本地当前页面，无法外导或开子窗。
function hardenWebContents(wc: WebContents, allowedUrl: string): void {
  const blockForeign = (e: { preventDefault: () => void }, url: string): void => {
    if (url !== allowedUrl) e.preventDefault();
  };
  wc.on('will-navigate', blockForeign);
  wc.on('will-redirect', blockForeign);
  // 一律拒绝新窗口；不打开外部浏览器。
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 禁止附加 <webview>。
  wc.on('will-attach-webview', (e) => {
    e.preventDefault();
  });
  // 拒绝所有权限请求（通知、地理位置、媒体等本应用都不需要）。
  wc.session.setPermissionRequestHandler((_wcc, _perm, cb) => cb(false));
}

// 角色运行画布为正方形；窗口大小按角色高度等比，留出道具/气泡余量。
// 窗口高度 = 角色高度 × 该系数（画布 512 中角色约占 400，另加顶部道具空间）。
const WINDOW_SCALE = 512 / 400;
const EDGE_MARGIN = 24;

export type DragSession = {
  active: boolean;
  // 指针相对角色窗左上角的偏移（DIP），拖动中保持不变。
  grabOffsetX: number;
  grabOffsetY: number;
};

export class WindowManager {
  private pet: BrowserWindow | null = null;
  private bubble: BrowserWindow | null = null;
  private settings: BrowserWindow | null = null;
  private drag: DragSession = { active: false, grabOffsetX: 0, grabOffsetY: 0 };
  private characterHeight = CHARACTER_HEIGHT_DEFAULT;
  private bubbleTimer: NodeJS.Timeout | null = null;
  private onSettingsClosed: (() => void) | null = null;
  private onPetGone: (() => void) | null = null;
  // 角色页面是否已首帧加载完成（控制是否可立即显示，避免未就绪先闪窗）。
  private petLoaded = false;
  // 系统挂起（休眠/锁屏）导致的隐藏，独立于用户主动隐藏；不写入偏好。
  private systemSuspended = false;

  constructor(private prefs: Preferences) {
    this.characterHeight = prefs.characterHeight;
  }

  /** 有效隐藏：用户主动隐藏或系统挂起，任一为真即不显示角色窗。 */
  private get effectiveHidden(): boolean {
    return this.prefs.hidden || this.systemSuspended;
  }

  /** 注册设置窗关闭回调（含异常退出）；主进程据此清除预览、恢复实时。 */
  setOnSettingsClosed(cb: () => void): void {
    this.onSettingsClosed = cb;
  }

  /** 注册角色渲染进程崩溃回调；主进程据此清理拖动会话并可重建角色窗。 */
  setOnPetGone(cb: () => void): void {
    this.onPetGone = cb;
  }

  /** 角色渲染进程崩溃后由主进程调用：清拖动会话并销毁旧窗口，便于重建。 */
  destroyPet(): void {
    this.drag = { active: false, grabOffsetX: 0, grabOffsetY: 0 };
    this.petLoaded = false;
    if (this.pet && !this.pet.isDestroyed()) this.pet.destroy();
    this.pet = null;
  }

  getPet(): BrowserWindow | null {
    return this.pet;
  }
  getBubble(): BrowserWindow | null {
    return this.bubble;
  }
  getSettings(): BrowserWindow | null {
    return this.settings;
  }

  /** 返回某 webContents 的窗口角色，用于 IPC 按角色限制通道；未知返回 null。 */
  roleOf(webContentsId: number): Role | null {
    if (this.pet && !this.pet.isDestroyed() && this.pet.webContents.id === webContentsId) return 'pet';
    if (this.bubble && !this.bubble.isDestroyed() && this.bubble.webContents.id === webContentsId) return 'bubble';
    if (this.settings && !this.settings.isDestroyed() && this.settings.webContents.id === webContentsId) {
      return 'settings';
    }
    return null;
  }

  /**
   * 校验某条 IPC 是否来自可信发送者并返回其角色，否则 null。
   * 要求：sender 是已知窗口；senderFrame 存在且就是该 wc 的主 frame（拒绝子 frame/iframe）；
   * 该主 frame 当前 URL 精确等于该角色绑定的本地页面 URL（拒绝被导航后或伪造的页面）。
   */
  isTrustedSender(sender: WebContents, senderFrame: WebFrameMain | null): Role | null {
    const role = this.roleOf(sender.id);
    if (!role) return null;
    if (!senderFrame) return null;
    // 必须是主 frame 本身，而不仅是“无父级”。
    if (senderFrame !== sender.mainFrame) return null;
    if (senderFrame.url !== ROLE_URL[role]) return null;
    return role;
  }

  private windowSize(): number {
    return Math.round(this.characterHeight * WINDOW_SCALE);
  }

  /** 创建角色窗：透明、无边框、无阴影、默认置顶、不激活、不进 Dock 焦点。 */
  createPetWindow(): BrowserWindow {
    if (this.pet && !this.pet.isDestroyed()) return this.pet;
    const size = this.windowSize();
    const { x, y } = this.resolveInitialPosition(size);

    this.pet = new BrowserWindow({
      width: size,
      height: size,
      x,
      y,
      show: false, // 先隐藏，首帧加载完再 showInactive，避免隐藏启动先闪一下。
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false, // 自行用 setPosition 实现精细拖动，不用系统拖动区。
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false, // 不抢键盘焦点。
      alwaysOnTop: this.prefs.alwaysOnTop,
      acceptFirstMouse: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // 关闭无用能力，减小攻击面。
        webgl: false,
        spellcheck: false
      }
    });

    // 默认普通窗口上方；不跨所有 Spaces、不覆盖全屏应用（实际表现需 Mac 实测）。
    this.pet.setAlwaysOnTop(this.prefs.alwaysOnTop, 'floating');
    if (process.platform === 'darwin') this.pet.setVisibleOnAllWorkspaces(false);
    // 初始即穿透：首帧命中掩码就绪前，不要留下整块可拦截的透明矩形。
    // 渲染进程启动时也会立即上报未命中；此处双保险，避免加载窗口期拦截下方点击。
    this.pet.setIgnoreMouseEvents(true, { forward: true });
    hardenWebContents(this.pet.webContents, ROLE_URL.pet);

    // 首帧加载完才显示：若此刻为有效隐藏（用户隐藏或系统挂起）则保持隐藏，
    // 不让 did-finish-load 把窗口重新亮出来；加载完成后由 showPet 决定可见性。
    this.petLoaded = false;
    this.pet.loadURL(ROLE_URL.pet);
    this.pet.webContents.once('did-finish-load', () => {
      this.petLoaded = true;
      if (!this.effectiveHidden) this.pet?.showInactive();
    });

    // 角色渲染进程崩溃：销毁窗口以便下次恢复；菜单栏仍可“显示秦彻”重建。
    this.pet.webContents.on('render-process-gone', () => {
      this.onPetGone?.();
    });

    return this.pet;
  }

  private bubbleReady = false;
  private pendingBubble: { text: string; ttlMs: number } | null = null;

  createBubbleWindow(): BrowserWindow {
    if (this.bubble && !this.bubble.isDestroyed()) return this.bubble;
    this.bubbleReady = false;
    this.bubble = new BrowserWindow({
      width: 260,
      height: 96,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      show: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    this.bubble.setIgnoreMouseEvents(true); // 气泡不接收鼠标。
    if (process.platform === 'darwin') this.bubble.setVisibleOnAllWorkspaces(false);
    hardenWebContents(this.bubble.webContents, ROLE_URL.bubble);
    this.bubble.loadURL(ROLE_URL.bubble);
    return this.bubble;
  }

  /** 气泡页面注册完监听后由主进程调用：发送最新待发文本并显示。 */
  markBubbleReady(): void {
    this.bubbleReady = true;
    if (this.pendingBubble) {
      const { text, ttlMs } = this.pendingBubble;
      this.pendingBubble = null;
      this.deliverBubble(text, ttlMs);
    }
  }

  /**
   * 显示气泡约 ttl 毫秒。页面未就绪时缓存最新文本，就绪后再发（避免首次丢字）；
   * 已就绪则直接发送最新文本并重置 TTL（快速连点显示最新内容）。
   */
  showBubble(text: string, ttlMs = 5000): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    this.createBubbleWindow();
    if (!this.bubbleReady) {
      this.pendingBubble = { text, ttlMs }; // 只保留最新一条。
      return;
    }
    this.deliverBubble(text, ttlMs);
  }

  private deliverBubble(text: string, ttlMs: number): void {
    if (!this.pet || this.pet.isDestroyed() || !this.bubble || this.bubble.isDestroyed()) return;
    const petBounds = this.pet.getBounds();
    const display = screen.getDisplayMatching(petBounds);
    const bb = this.bubble.getBounds();
    const wa = display.workArea;

    // 优先放角色上方；上方空间不足则放下方。
    let bx = Math.round(petBounds.x + petBounds.width / 2 - bb.width / 2);
    let by = petBounds.y - bb.height + 8;
    if (by < wa.y) by = petBounds.y + petBounds.height - 8;
    // 纵横都约束回工作区，避免被裁掉。
    bx = Math.max(wa.x, Math.min(bx, wa.x + wa.width - bb.width));
    by = Math.max(wa.y, Math.min(by, wa.y + wa.height - bb.height));
    this.bubble.setPosition(bx, by);

    this.bubble.webContents.send('push:bubble', text, ttlMs);
    this.bubble.showInactive();

    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      if (this.bubble && !this.bubble.isDestroyed()) this.bubble.hide();
    }, ttlMs);
  }

  /** 隐藏/活动变更时立即关闭现有气泡，避免旧状态残留。 */
  dismissBubble(): void {
    this.pendingBubble = null;
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    if (this.bubble && !this.bubble.isDestroyed()) this.bubble.hide();
  }

  createOrShowSettings(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show();
      this.settings.focus();
      return this.settings;
    }
    this.settings = new BrowserWindow({
      width: 520,
      height: 640,
      title: '秦彻陪伴 · 设置',
      autoHideMenuBar: process.platform === 'win32',
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    });
    hardenWebContents(this.settings.webContents, ROLE_URL.settings);
    this.settings.loadURL(ROLE_URL.settings);
    this.settings.once('ready-to-show', () => {
      this.settings?.show();
      this.settings?.focus();
    });
    // 关闭（含异常退出）即通知主进程清除预览、恢复实时。
    this.settings.on('closed', () => {
      this.settings = null;
      this.onSettingsClosed?.();
    });
    // 设置窗渲染进程崩溃：销毁旧窗并清预览（不只处理 closed，覆盖渲染进程异常）。
    this.settings.webContents.on('render-process-gone', () => {
      if (this.settings && !this.settings.isDestroyed()) this.settings.destroy();
      this.settings = null;
      this.onSettingsClosed?.();
    });
    return this.settings;
  }

  // --- 置顶、尺寸、可见性 ---

  setAlwaysOnTop(value: boolean): void {
    this.prefs = { ...this.prefs, alwaysOnTop: value };
    this.pet?.setAlwaysOnTop(value, 'floating');
  }

  /** 改变角色高度：保持底部锚点稳定地重设尺寸与位置，再约束回可见工作区。 */
  setCharacterHeight(height: number): void {
    if (!this.pet || this.pet.isDestroyed()) {
      this.characterHeight = height;
      return;
    }
    const before = this.pet.getBounds();
    // 锚点：窗口底部中心。
    const anchorX = before.x + before.width / 2;
    const anchorBottom = before.y + before.height;
    this.characterHeight = height;
    const size = this.windowSize();
    const nx = Math.round(anchorX - size / 2);
    const ny = Math.round(anchorBottom - size);
    this.pet.setBounds({ x: nx, y: ny, width: size, height: size });
    // 放大后可能超出工作区（尤其靠边时），约束回可见范围避免被裁。
    this.constrainToWorkArea();
    this.syncAnchorToPrefs();
  }

  /** 把当前角色底部锚点与显示器写回内存中的 prefs，供渲染进程崩溃后重建时沿用最新位置。 */
  private syncAnchorToPrefs(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    const b = this.pet.getBounds();
    const display = screen.getDisplayMatching(b);
    this.prefs = {
      ...this.prefs,
      anchorX: b.x + b.width / 2,
      anchorY: b.y + b.height,
      displayId: display.id
    };
  }

  /**
   * 更新用户主动隐藏偏好并据此显隐。隐藏时清理拖动与气泡；
   * 显示时若系统仍挂起则不真正亮窗（等 resume）。
   */
  setUserHidden(hidden: boolean): void {
    this.prefs = { ...this.prefs, hidden };
    this.applyVisibility();
  }

  /** 系统挂起/恢复导致的隐藏，独立于用户偏好；不写入 prefs。 */
  setSystemSuspended(suspended: boolean): void {
    if (this.systemSuspended === suspended) return;
    this.systemSuspended = suspended;
    this.applyVisibility();
  }

  /** 当前对渲染进程而言的有效隐藏（供主进程下发给 renderer 以暂停动画）。 */
  isEffectivelyHidden(): boolean {
    return this.effectiveHidden;
  }

  /** 兼容旧入口：显示角色（清除用户隐藏偏好并据有效可见性显隐）。 */
  showPet(): void {
    this.setUserHidden(false);
  }

  /** 兼容旧入口：按用户隐藏显隐（主进程 applyPreferences 调用）。 */
  hidePet(): void {
    this.setUserHidden(true);
  }

  /**
   * 依据有效隐藏统一显隐角色窗。
   * 隐藏：清理拖动会话与气泡（含 pending），hide 窗口；不让后续 did-finish-load 重新显示。
   * 显示：窗口已加载则立即 showInactive，否则保持隐藏等待加载完成再显示（不提前闪窗）。
   */
  private applyVisibility(): void {
    if (this.effectiveHidden) {
      this.drag = { active: false, grabOffsetX: 0, grabOffsetY: 0 };
      this.dismissBubble();
      if (this.pet && !this.pet.isDestroyed()) this.pet.hide();
      return;
    }
    this.createPetWindow();
    if (this.petLoaded && this.pet && !this.pet.isDestroyed()) {
      this.pet.showInactive();
    }
    // 未加载完成：不提前显示，由 did-finish-load 回调按 effectiveHidden 决定。
  }

  // --- 精细点击穿透 ---

  /**
   * 根据当前帧命中结果切换是否接收鼠标。
   * 未命中：忽略鼠标但保留移动转发，让下方应用可点，同时继续收到移动以更新命中。
   * 命中或拖动中：恢复接收鼠标。
   */
  setPointerHit(hit: boolean): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    if (this.drag.active) {
      this.pet.setIgnoreMouseEvents(false);
      return;
    }
    if (hit) {
      this.pet.setIgnoreMouseEvents(false);
    } else {
      this.pet.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  // --- 拖动会话（精细，不使用系统拖动区） ---

  beginDrag(point?: {x: number; y: number}): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    const cursor = point ?? screen.getCursorScreenPoint();
    const b = this.pet.getBounds();
    this.drag = {
      active: true,
      grabOffsetX: cursor.x - b.x,
      grabOffsetY: cursor.y - b.y
    };
    // 拖动中锁定接收鼠标。
    this.pet.setIgnoreMouseEvents(false);
  }

  moveDrag(point?: {x: number; y: number}): void {
    if (!this.drag.active || !this.pet || this.pet.isDestroyed()) return;
    const cursor = point ?? screen.getCursorScreenPoint();
    this.pet.setPosition(
      Math.round(cursor.x - this.drag.grabOffsetX),
      Math.round(cursor.y - this.drag.grabOffsetY)
    );
  }

  /** 结束拖动，约束回可见工作区，返回新的底部锚点坐标与显示器 id 以便持久化。 */
  endDrag(): { anchorX: number; anchorY: number; displayId: number } | null {
    this.drag = { active: false, grabOffsetX: 0, grabOffsetY: 0 };
    if (!this.pet || this.pet.isDestroyed()) return null;
    this.constrainToWorkArea();
    this.syncAnchorToPrefs();
    const b = this.pet.getBounds();
    const display = screen.getDisplayMatching(b);
    return {
      anchorX: b.x + b.width / 2,
      anchorY: b.y + b.height,
      displayId: display.id
    };
  }

  isDragging(): boolean {
    return this.drag.active;
  }

  /** 把角色窗约束回其所在显示器的可见工作区。 */
  private constrainToWorkArea(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    const b = this.pet.getBounds();
    const display = screen.getDisplayMatching(b);
    const wa = display.workArea;
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width));
    const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height));
    if (x !== b.x || y !== b.y) this.pet.setPosition(x, y);
  }

  /** 回到主屏右下角。 */
  moveToPrimary(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    const primary = screen.getPrimaryDisplay();
    const size = this.windowSize();
    const { x, y } = this.bottomRight(primary, size);
    this.pet.setPosition(x, y);
    this.syncAnchorToPrefs();
  }

  /** 显示器变化：若角色所在显示器被移除或位置越界，回到主屏可见区。 */
  handleDisplaysChanged(): { anchorX: number; anchorY: number; displayId: number } | null {
    if (!this.pet || this.pet.isDestroyed()) return null;
    const b = this.pet.getBounds();
    const displays = screen.getAllDisplays();
    const stillVisible = displays.some(
      (d) =>
        b.x < d.bounds.x + d.bounds.width &&
        b.x + b.width > d.bounds.x &&
        b.y < d.bounds.y + d.bounds.height &&
        b.y + b.height > d.bounds.y
    );
    if (!stillVisible) {
      this.moveToPrimary();
    } else {
      this.constrainToWorkArea();
    }
    this.syncAnchorToPrefs();
    const nb = this.pet.getBounds();
    const display = screen.getDisplayMatching(nb);
    return {
      anchorX: nb.x + nb.width / 2,
      anchorY: nb.y + nb.height,
      displayId: display.id
    };
  }

  /** 首次或恢复时解析初始位置：优先用保存的锚点与显示器，否则主屏右下角。 */
  private resolveInitialPosition(size: number): { x: number; y: number } {
    const { anchorX, anchorY, displayId } = this.prefs;
    if (anchorX !== null && anchorY !== null) {
      // 锚点是底部中心，换算成窗口左上角。
      const x = Math.round(anchorX - size / 2);
      const y = Math.round(anchorY - size);
      // 保存过 displayId：仅当该显示器仍存在才沿用；不存在则回主屏右下角，
      // 不随意选“最近”屏（避免恢复到用户没预期的另一块屏）。
      if (displayId !== null) {
        const target = screen.getAllDisplays().find((d) => d.id === displayId);
        if (!target) {
          return this.bottomRight(screen.getPrimaryDisplay(), size);
        }
        const wa = target.workArea;
        return {
          x: Math.max(wa.x, Math.min(x, wa.x + wa.width - size)),
          y: Math.max(wa.y, Math.min(y, wa.y + wa.height - size))
        };
      }
      // 未记录 displayId：按锚点所在显示器约束。
      const display = screen.getDisplayMatching({ x, y, width: size, height: size });
      const wa = display.workArea;
      return {
        x: Math.max(wa.x, Math.min(x, wa.x + wa.width - size)),
        y: Math.max(wa.y, Math.min(y, wa.y + wa.height - size))
      };
    }
    return this.bottomRight(screen.getPrimaryDisplay(), size);
  }

  private bottomRight(display: Display, size: number): { x: number; y: number } {
    const wa = display.workArea;
    return {
      x: wa.x + wa.width - size - EDGE_MARGIN,
      y: wa.y + wa.height - size - EDGE_MARGIN
    };
  }

  /** 当前角色底部锚点与显示器（用于退出前持久化）。 */
  currentAnchor(): { anchorX: number; anchorY: number; displayId: number } | null {
    if (!this.pet || this.pet.isDestroyed()) return null;
    const b = this.pet.getBounds();
    const display = screen.getDisplayMatching(b);
    return {
      anchorX: b.x + b.width / 2,
      anchorY: b.y + b.height,
      displayId: display.id
    };
  }
}
