// 构建脚本：用 esbuild 分别打包主进程(ESM)、preload(CJS)、三个渲染页面(浏览器)，
// 复制 HTML/CSS 与作息配置，并运行素材准备。不联网、不解码整个素材库。
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareAssets } from './prepare-assets.mjs';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appRoot, 'src');
const dist = join(appRoot, 'dist');

async function clean() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
}

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: ['node20', 'chrome124'],
  define: { 'process.env.NODE_ENV': '"production"' }
};

async function buildMain() {
  await build({
    ...common,
    entryPoints: [join(src, 'main/index.ts')],
    outfile: join(dist, 'main/index.js'),
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    // Electron 自带，不打包进去。
    external: ['electron'],
    // ESM 主进程中保留对 __dirname 的替代由代码侧用 import.meta 处理。
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
    }
  });
}

async function buildPreload() {
  // 沙箱 preload 必须是 CommonJS；输出 .cjs 以免被 type:module 当作 ESM。
  await build({
    ...common,
    entryPoints: [join(src, 'preload/index.ts')],
    outfile: join(dist, 'preload/index.cjs'),
    platform: 'node',
    format: 'cjs',
    target: ['node20'],
    external: ['electron']
  });
}

async function buildRenderers() {
  const pages = ['pet', 'bubble', 'settings'];
  for (const page of pages) {
    await build({
      ...common,
      entryPoints: [join(src, `renderer/${page}/index.ts`)],
      outfile: join(dist, `renderer/${page}/index.js`),
      platform: 'browser',
      format: 'esm'
    });
    // 复制该页面目录下的 html/css 等静态资源。
    const pageDir = join(src, `renderer/${page}`);
    for (const entry of await readdir(pageDir)) {
      if (entry.endsWith('.html') || entry.endsWith('.css')) {
        await cp(join(pageDir, entry), join(dist, `renderer/${page}/${entry}`));
      }
    }
  }
}

async function copyConfig() {
  await mkdir(join(dist, 'config'), { recursive: true });
  await cp(join(src, 'config/schedule.json'), join(dist, 'config/schedule.json'));
}

async function main() {
  await clean();
  await Promise.all([buildMain(), buildPreload(), buildRenderers(), copyConfig()]);
  await prepareAssets({ appRoot });
  console.log('[build] 完成');
}

main().catch((err) => {
  console.error('[build] 失败', err);
  process.exit(1);
});
