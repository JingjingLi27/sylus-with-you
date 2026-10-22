// 自定义协议 qinche-asset://，只允许读取 assets/runtime 下的文件。
// 防止路径穿越；渲染进程不接受任意外部路径作为素材地址。

import { protocol, net } from 'electron';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// 构建后 dist/main/ 旁无 assets，运行时素材在 app 根的 assets/runtime。
// dist/main/index.js → ../../assets/runtime （dist 与 assets 同级于 app 根）。
const RUNTIME_DIR = join(here, '../../assets/runtime');

export const ASSET_SCHEME = 'qinche-asset';

/** 必须在 app.whenReady 之前调用，声明协议特权。 */
export function registerAssetSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      // Electron 44 下，file:// 渲染页 fetch 自定义协议属跨源请求；若 scheme 未声明
      // corsEnabled，Chromium 直接以 "scheme not supported for CORS" 拒绝（net::ERR_FAILED）。
      // 开启 corsEnabled 让该 scheme 走标准 CORS 流程，再由处理器显式返回放行头。
      // 继续保持 bypassCSP:false —— 不绕过渲染进程 CSP，安全策略不变。
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ]);
}

// 仅允许访问的素材子目录与扩展名，避免泛读 runtime 任意条目（如 manifest.json 由 IPC 提供）。
const ALLOWED_PREFIX = 'gifs/';
const ALLOWED_EXT = new Set(['.gif', '.png']);

// 本地素材无凭据、无远程来源：对 file:// 渲染页统一放行即可。
// 用 '*' 而非具体 origin，因打包后 file:// 页面的 Origin 常序列化为 "null"，
// 显式回放 "null" 反而易漏配；通配在无 credentials 场景下安全且足够。
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET'
};

/** 为响应补上 CORS 放行头；跨源 fetch 要求实际响应也带 Allow-Origin，否则仍被拒。 */
function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** 在 app ready 后调用，处理 qinche-asset:// 请求。 */
export function registerAssetProtocol(): void {
  // 所有返回（含校验失败/错误响应）统一补 CORS 头：跨源 fetch 对失败响应也需放行头，
  // 否则浏览器以 CORS 失败掩盖真实状态码，排障困难。
  protocol.handle(ASSET_SCHEME, async (request) => withCors(await resolveAsset(request)));
}

/** 实际解析逻辑：返回裸响应，CORS 头由 registerAssetProtocol 统一附加。 */
async function resolveAsset(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  // 限定 host=runtime，拒绝其它主机。
  if (url.host !== 'runtime') {
    return new Response('not found', { status: 404 });
  }

  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return new Response('bad path', { status: 400 });
  }

  // 只允许 gifs/ 下、受支持扩展名的素材。
  if (!rel.startsWith(ALLOWED_PREFIX)) {
    return new Response('forbidden', { status: 403 });
  }
  const dot = rel.lastIndexOf('.');
  const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) {
    return new Response('forbidden', { status: 403 });
  }

  const target = normalize(join(RUNTIME_DIR, rel));
  // 路径穿越防护：规整后必须仍在 RUNTIME_DIR/gifs 之内。
  const gifsDir = normalize(join(RUNTIME_DIR, 'gifs'));
  if (target !== gifsDir && !target.startsWith(gifsDir + sep)) {
    return new Response('forbidden', { status: 403 });
  }

  try {
    await access(target);
  } catch {
    return new Response('not found', { status: 404 });
  }

  try {
    return await net.fetch(pathToFileURL(target).toString());
  } catch {
    return new Response('read error', { status: 500 });
  }
}

/** 生成渲染进程使用的素材 URL。 */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return `${ASSET_SCHEME}://runtime/${clean}`;
}
