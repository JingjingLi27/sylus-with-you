// Cross-package the Windows x64 portable application without Wine.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const [output] = await packager({
  dir: root, name: '秦彻陪伴', executableName: 'QincheCompanion',
  platform: 'win32', arch: 'x64', out: join(root, 'release'), overwrite: true,
  asar: true, icon: join(root, 'assets/icons/schedule-round.ico'),
  ...(process.env.QINCHE_ELECTRON_ZIP_DIR ? {electronZipDir: resolve(process.env.QINCHE_ELECTRON_ZIP_DIR)} : {}),
  win32metadata: { ProductName: '秦彻陪伴', FileDescription: '秦彻陪伴桌面宠物' },
  ignore: [/^\/src($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/release($|\/)/,
    /^\/output($|\/)/, /^\/\.playwright-cli($|\/)/, /^\/\.git($|\/)/]
});
await writeFile(join(output, '使用说明.txt'), '\ufeff' + [
  `秦彻陪伴 ${version} · Windows x64 免安装版`,
  '', '适用：Windows 10/11 64 位 Intel 或 AMD 电脑。此包未在 Windows 实机验收。',
  '1. 将整个压缩包解压到一个普通文件夹，不能直接在压缩包内运行。',
  '2. 双击 QincheCompanion.exe。无需 Node.js、Claude、API Key 或联网。',
  '3. 点击角色可互动；拖动角色可移动；右键打开作息、大小、隐藏等菜单。',
  '4. 隐藏后，在右下角托盘（可能在折叠区）右键图标，选择显示秦彻。',
  '5. 左键点托盘图标打开设置；退出请用托盘或角色右键菜单的退出。',
  '6. 请保留 exe 旁所有文件及 resources 文件夹，不要只复制 exe。',
  '', '设置保存在 %APPDATA%\\qinche-companion\\settings.json。',
  '程序未进行代码签名，Windows 可能提示未知发布者。',
  '卸载：先退出程序，再删除解压文件夹；个人设置会保留。',
  '', '待实机确认：透明区域穿透、拖动、高 DPI、多屏、睡眠恢复及托盘行为。'
].join('\r\n'), 'utf8');
console.log(`Windows portable directory: ${output}`);
