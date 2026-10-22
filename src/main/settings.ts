// SettingsStore：读写用户数据目录下的 settings.json。
// 读入时清洗与范围校验；损坏文件备份后回退默认。写入串行化：先写临时文件再替换，
// 设置变更做短暂防抖，退出前 flush 待写入。不保存运行期状态（活动、帧号、预览时间）。

import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, sanitizePreferences } from '../domain/preferences.js';
import type { Preferences } from '../domain/types.js';

const WRITE_DEBOUNCE_MS = 400;

export class SettingsStore {
  private readonly filePath: string;
  private readonly dir: string;
  private current: Preferences = defaultPreferences();
  private writeTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWrite = false;

  constructor(userDataDir = app.getPath('userData')) {
    this.dir = userDataDir;
    this.filePath = join(userDataDir, 'settings.json');
  }

  get(): Preferences {
    return this.current;
  }

  /** 启动时加载。损坏文件备份为 settings.corrupt-<时间>.json 后使用默认值。 */
  async load(): Promise<Preferences> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await this.backupCorrupt(raw);
        this.current = defaultPreferences();
        return this.current;
      }
      this.current = sanitizePreferences(parsed);
    } catch {
      // 文件不存在：首次运行，使用默认值。
      this.current = defaultPreferences();
    }
    return this.current;
  }

  /** 合并补丁并安排防抖写盘。补丁已假定由上层清洗过范围。 */
  update(patch: Partial<Preferences>): Preferences {
    this.current = sanitizePreferences({ ...this.current, ...patch });
    this.scheduleWrite();
    return this.current;
  }

  private scheduleWrite(): void {
    this.pendingWrite = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      // 定时触发的写入吞掉异常，仅记日志，避免未处理拒绝；下次 update/flush 可重试。
      this.flush().catch((err) => {
        console.error('[settings] 定时写入失败，稍后重试：', (err as Error).message);
      });
    }, WRITE_DEBOUNCE_MS);
  }

  /**
   * 立即写盘并等待完成（退出前调用）。写操作串行化但单次失败不污染后续：
   * writeChain 始终以已解决的 Promise 续接，捕获并记录错误；pendingWrite 在成功后才清除，
   * 失败时保留以便下次重试。退出调用 flush 即使失败也能返回（不卡死 before-quit）。
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.pendingWrite) {
      await this.writeChain;
      return;
    }
    const snapshot = this.current;
    // 续接到链尾；无论上次成败都从已解决状态开始，防止一次 reject 永久卡死。
    this.writeChain = this.writeChain.then(
      () => this.attemptWrite(snapshot),
      () => this.attemptWrite(snapshot)
    );
    await this.writeChain;
  }

  /** 尝试一次原子写入；成功才清 pendingWrite，失败记录日志并保留待重试。 */
  private async attemptWrite(prefs: Preferences): Promise<void> {
    try {
      await this.writeAtomic(prefs);
      // 若期间没有新的变更，才认为已落盘。
      if (this.current === prefs) this.pendingWrite = false;
    } catch (err) {
      console.error('[settings] 写入失败，保留待重试：', (err as Error).message);
    }
  }

  private async writeAtomic(prefs: Preferences): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `settings.tmp-${process.pid}.json`);
    const data = JSON.stringify(prefs, null, 2);
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, this.filePath);
  }

  private async backupCorrupt(raw: string): Promise<void> {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = join(this.dir, `settings.corrupt-${stamp}.json`);
      await writeFile(backup, raw, 'utf8');
    } catch {
      // 备份失败不阻断启动。
    }
  }
}
