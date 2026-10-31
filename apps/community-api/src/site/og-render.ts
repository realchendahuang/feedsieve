/**
 * OG 卡光栅化与取数路由：SVG 模板（og.ts）→ @resvg/resvg-wasm → PNG。
 * wasm / 子集字体（public/fonts，Noto Sans SC，OFL）/ 福滤娃头像都是
 * isolate 级一次性加载（模块级 memo），缓存命中后零 D1、零重复初始化。
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasmModule from '@resvg/resvg-wasm/index_bg.wasm?module';
import type { OgLogo } from './og';

// ASSETS 绑定按站点自身 origin 取内部资产（dev 为 localhost，生产为站点 host）
const FONT_PATHS = ['/fonts/og-noto-sc-400.ttf', '/fonts/og-noto-sc-700.ttf'] as const;

let wasmReady: Promise<void> | null = null;
let fontsPromise: Promise<Uint8Array[]> | null = null;
let logoPromise: Promise<OgLogo | null> | null = null;

function fetchAsset(env: Cloudflare.Env, path: string, origin: string): Promise<Response> {
  return env.ASSETS.fetch(new URL(path, origin));
}

function loadFonts(env: Cloudflare.Env, origin: string): Promise<Uint8Array[]> {
  return (fontsPromise ??= Promise.all(
    FONT_PATHS.map(async (path) => {
      const res = await fetchAsset(env, path, origin);
      if (!res.ok) throw new Error(`OG 字体缺失：${path}（res ${res.status}）`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  ));
}

export async function renderOgPng(
  env: Cloudflare.Env,
  svg: string,
  origin: string,
): Promise<Uint8Array<ArrayBuffer>> {
  wasmReady ??= initWasm(wasmModule).catch((err: unknown) => {
    // dev HMR 会重载业务模块但缓存 node_modules：胶水的 initialized 标志仍在，视为就绪
    if (String((err as Error | undefined)?.message ?? err).includes('Already initialized')) {
      wasmReady = Promise.resolve();
      return;
    }
    wasmReady = null; // 真实初始化失败：下次请求重试
    throw err;
  });
  await wasmReady;
  const fontBuffers = await loadFonts(env, origin);
  const resvg = new Resvg(svg, {
    font: { fontBuffers, defaultFontFamily: 'Noto Sans SC' },
  });
  const png = resvg.render().asPng();
  resvg.free();
  // asPng 的 Uint8Array 与 BodyInit 的 TS 视图不兼容，拷贝为标准 ArrayBuffer 视图
  return new Uint8Array(png);
}

/** 福滤娃头像 → data URI（/_assets/avatar.png 经 ASSETS 绑定，含 admin 打包资产） */
export async function feedSieveLogo(env: Cloudflare.Env, origin: string): Promise<OgLogo | null> {
  return (logoPromise ??= loadLogo(env, origin));
}

function pngAspect(buf: ArrayBuffer): number {
  const b = new Uint8Array(buf);
  const be32 = (o: number) =>
    (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
  // PNG：8 字节签名 + IHDR 长度/类型 8 字节，宽高在偏移 16/20
  const w = be32(16);
  const h = be32(20);
  return w > 0 && h > 0 ? w / h : 1;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function loadLogo(env: Cloudflare.Env, origin: string): Promise<OgLogo | null> {
  const res = await fetchAsset(env, '/assets/avatar.png', origin);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return { href: `data:image/png;base64,${toBase64(buf)}`, aspect: pngAspect(buf) };
}
