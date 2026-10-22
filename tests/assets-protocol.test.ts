import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 捕获注册到 protocol.handle 的处理器与特权声明；electron 在 node 测试环境不可直接加载。
let capturedHandler: ((request: Request) => Promise<Response>) | null = null;
let capturedPrivileges: unknown = null;
const netFetch = vi.fn<(url: string) => Promise<Response>>();

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: unknown) => {
      capturedPrivileges = schemes;
    },
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      capturedHandler = handler;
    }
  },
  net: {
    fetch: (url: string) => netFetch(url)
  }
}));

// 默认素材存在；个别用例覆写为“缺失”。
const access = vi.fn<(path: string) => Promise<void>>();
vi.mock('node:fs/promises', () => ({
  access: (p: string) => access(p)
}));

import {
  ASSET_SCHEME,
  assetUrl,
  registerAssetProtocol,
  registerAssetSchemePrivileges
} from '../src/main/assets-protocol.js';

function handle(url: string): Promise<Response> {
  if (!capturedHandler) throw new Error('handler 未注册');
  return capturedHandler(new Request(url));
}

beforeEach(() => {
  capturedHandler = null;
  capturedPrivileges = null;
  netFetch.mockReset();
  access.mockReset();
  access.mockResolvedValue(undefined);
  registerAssetProtocol();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('素材协议：特权声明', () => {
  it('开启 corsEnabled 并保持 bypassCSP=false', () => {
    registerAssetSchemePrivileges();
    expect(capturedPrivileges).toEqual([
      {
        scheme: ASSET_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          bypassCSP: false
        }
      }
    ]);
  });
});

describe('素材协议：CORS 响应头', () => {
  it('成功响应带放行头', async () => {
    netFetch.mockResolvedValue(new Response('gif-bytes', { status: 200 }));
    const res = await handle(assetUrl('gifs/sing.gif'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET');
    expect(netFetch).toHaveBeenCalledTimes(1);
  });

  it('校验失败响应同样带放行头，便于暴露真实状态码', async () => {
    const forbidden = await handle(`${ASSET_SCHEME}://runtime/secrets/manifest.json`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const notFound = await handle(`${ASSET_SCHEME}://other/gifs/sing.gif`);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('素材协议：既有校验保持不变', () => {
  it('拒绝非 gifs/ 前缀', async () => {
    const res = await handle(`${ASSET_SCHEME}://runtime/manifest.json`);
    expect(res.status).toBe(403);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('拒绝不支持的扩展名', async () => {
    const res = await handle(assetUrl('gifs/evil.svg'));
    expect(res.status).toBe(403);
  });

  it('拒绝路径穿越', async () => {
    const res = await handle(`${ASSET_SCHEME}://runtime/gifs/../../package.json`);
    expect(res.status).toBe(403);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('素材缺失返回 404', async () => {
    access.mockRejectedValue(new Error('ENOENT'));
    const res = await handle(assetUrl('gifs/missing.gif'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('读取异常返回 500', async () => {
    netFetch.mockRejectedValue(new Error('boom'));
    const res = await handle(assetUrl('gifs/sing.gif'));
    expect(res.status).toBe(500);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
