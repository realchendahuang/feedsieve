/**
 * 管理后台 Access 中间件全链路测试（HTTP 守卫本身）。
 *
 * access-admin-workflow.test.ts 直接调用仓库函数，绕过了两条真实防线：
 * 1) host gate —— /api/admin/* 只接受 ADMIN_HOST 的主机名，其它主机一律 404；
 * 2) Cloudflare Access JWT 校验 —— Cf-Access-Jwt-Assertion 必须由
 *    ACCESS_JWKS_URL 对应密钥签发、算法限定 RS256/ES256、audience 匹配、
 *    issuer 归属团队域、email 在允许列表内。
 *
 * 本文件用真实 ES256 密钥签发 JWT（与 verifyAccess 的算法白名单一致），并
 * stub 全局 fetch 让 jose 的 createRemoteJWKSet 从测试内拦截到假 JWKS
 * （main worker 与测试运行在同一 isolate，全局 mock 对 worker 内部调用同样生效）。
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
  /** 算法白名单外（EdDSA/Ed25519）签发的 token：密钥在 JWKS 内，其余声明全部有效 */
  ed25519Token: string;
}

let fixture: JwtFixture | undefined;
let originalFetch: typeof fetch;

async function generateEs256KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

async function signToken(email: string, audience: string, key: CryptoKey): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-access-key' })
    .setAudience(audience)
    .setIssuer('https://test.cloudflareaccess.com')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

// workers-types 的 generateKey 对 Ed25519 重载返回联合类型，显式断言成密钥对
async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

beforeAll(async () => {
  const keyPair = await generateEs256KeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  // 与 verifyAccess 的 createRemoteJWKSet 消费格式一致：EC/P-256 + kid + alg ES256
  const edPair = await generateEd25519KeyPair();
  const edJwk = await crypto.subtle.exportKey('jwk', edPair.publicKey);
  const jwks = {
    keys: [
      { ...jwk, kid: 'test-access-key', alg: 'ES256', use: 'sig' },
      { ...edJwk, kid: 'test-access-ed', alg: 'Ed25519', use: 'sig' },
    ],
  };

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
    // 算法白名单外的合法密钥签名（密钥就在 JWKS 里）：验证 algorithms 钉死生效
    ed25519Token: await new SignJWT({ email: 'maintainer@example.com' })
      .setProtectedHeader({ alg: 'Ed25519', kid: 'test-access-ed' })
      .setAudience(AUDIENCE)
      .setIssuer('https://test.cloudflareaccess.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(edPair.privateKey),
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
    const forgedKey = (await generateEs256KeyPair()).privateKey;
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

  it('算法白名单外（Ed25519 密钥就在 JWKS 内）：401（防 alg 混淆）', async () => {
    const response = await adminFetch(ADMIN_ORIGIN, {
      headers: { 'Cf-Access-Jwt-Assertion': fixture!.ed25519Token },
    });
    expect(response.status).toBe(401);
  });

  it('ACCESS_ALLOWED_EMAILS 为空：fail closed（漏配不等于全员放行）', async () => {
    const emptyAllowlist = { ...env, ACCESS_ALLOWED_EMAILS: undefined };
    const response = await worker.fetch(
      new Request(`${ADMIN_ORIGIN}/api/admin/me`, {
        headers: { 'Cf-Access-Jwt-Assertion': fixture!.token },
      }),
      emptyAllowlist,
    );
    expect(response.status).toBe(401);
  });
});