// 删除构建产物目录。只动 dist/，不碰源码与原始素材。
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
await rm(join(appRoot, 'dist'), { recursive: true, force: true });
console.log('[clean] 已删除 dist/');
