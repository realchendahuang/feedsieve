/**
 * 管理后台 Access 中间件全链路测试（HTTP 守卫本身）。
 *
 * access-admin-workflow.test.ts 直接调用仓库函数，绕过了两条真实防线：
 * 1) host gate —— /api/admin/* 只接受 ADMIN_HOST 的主机名，其它主机一律 404；
 * 2) Cloudflare Access JWT 校验 —— Cf-Access-Jwt-Assertion 必须由
 *    ACCESS_JWKS_URL 对应密钥签发、audience 匹配、email 在允许列表内。
 *
 * 本文件用真实 Ed25519 密钥签发 JWT，并 stub 全局 fetch 让
 * jose 的 createRemoteJWKSet 从测试内拦截到假 JWKS（main worker 与测试
 * 运行在同一 isolate，全局 mock 对 worker 内部调用同样生效）。
 */

import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import worker from '../src/index';

const ADMIN_ORIGIN = 'https://admin.feedsieve-api.chendahuang.com';
const FOREIGN_ORIGIN = 'https://api.example.com';
const AUDIENCE = 'feedsieve-test-aud';
const JWKS_PREFIX = 'https://jwks.test';

interface JwtFixture {
  token: string;
  wrongAudienceToken: string;
  otherEmailToken: string;
}

let fixture: JwtFixture | undefined;
let originalFetch: typeof fetch;

// workers-types 的 generateKey 对 Ed25519 重载返回联合类型，显式断言成密钥对
async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

async function signToken(email: string, audience: string, key: CryptoKey): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'Ed25519', kid: 'test-access-key' })
    .setAudience(audience)
    .setIssuer('https://test.cloudflareaccess.com')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

beforeAll(async () => {
  const keyPair = await generateEd25519KeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  // 与 verifyAccess 的 createRemoteJWKSet 消费格式一致：OKP/Ed25519 + kid + alg
  const jwks = { keys: [{ ...jwk, kid: 'test-access-key', alg: 'Ed25519', use: 'sig' }] };

  originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(JWKS_PREFIX)) {
        return new Response(JSON.stringify(jwks), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }),
  );

  fixture = {
    token: await signToken('maintainer@example.com', AUDIENCE, keyPair.privateKey),
    wrongAudienceToken: await signToken(
      'maintainer@example.com',
      'some-other-aud',
      keyPair.privateKey,
    ),
    otherEmailToken: await signToken('intruder@example.com', AUDIENCE, keyPair.privateKey),
  };
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function adminFetch(
  origin: string,
  init: { headers?: Record<string, string> } = {},
): Promise<Response> {
  return worker.fetch(new Request(`${origin}/api/admin/me`, init), env);
}

describe('管理后台 Access 中间件（HTTP 层）', () => {
  it('错误主机名访问 /api/admin/* 直接 404，不进入 JWT 校验', async () => {
    const response = await adminFetch(FOREIGN_ORIGIN);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('正确主机但缺 token：401', async () => {
    const response = await adminFetch(ADMIN_ORIGIN);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'access_required' });
  });

  it('伪造 token（非 JWKS 密钥签发）：401', async () => {
    const forgedKey = (await generateEd25519KeyPair()).privateKey;
    const forged = await signToken('maintainer@example.com', AUDIENCE, forgedKey);
    const response = await adminFetch(ADMIN_ORIGIN, {
      headers: { 'Cf-Access-Jwt-Assertion': forged },
    });
    expect(response.status).toBe(401);
  });

  it('有效 token + 允许列表内邮箱：放行并回显身份', async () => {
    const response = await adminFetch(ADMIN_ORIGIN, {
      headers: { 'Cf-Access-Jwt-Assertion': fixture!.token },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'maintainer@example.com' });
  });

  it('audience 不匹配：401（防跨应用重放）', async () => {
    const response = await adminFetch(ADMIN_ORIGIN, {
      headers: { 'Cf-Access-Jwt-Assertion': fixture!.wrongAudienceToken },
    });
    expect(response.status).toBe(401);
  });

  it('邮箱不在 ACCESS_ALLOWED_EMAILS：401', async () => {
    const response = await adminFetch(ADMIN_ORIGIN, {
      headers: { 'Cf-Access-Jwt-Assertion': fixture!.otherEmailToken },
    });
    expect(response.status).toBe(401);
  });
});