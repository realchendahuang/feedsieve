import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AccessIdentity { email: string }

// 每请求重建 createRemoteJWKSet 会丢掉 jose 的密钥缓存（每次管理请求都打
// 一次远端 JWKS 拉取/校验）。按 URL 记忆化，进程内共享同一套密钥缓存。
const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByUri.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByUri.set(url, jwks);
  }
  return jwks;
}

export async function verifyAccess(request: Request, env: Cloudflare.Env): Promise<AccessIdentity | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_AUD || !env.ACCESS_JWKS_URL) return null;
  try {
    const jwks = remoteJwks(env.ACCESS_JWKS_URL);
    const result = await jwtVerify(token, jwks, {
      audience: env.ACCESS_AUD,
      // Cloudflare Access 只以 RS256/ES256 签发；显式钉死算法，防 alg 混淆
      algorithms: ['RS256', 'ES256'],
      // 配置团队域时钉住 issuer：其它 Access 应用（乃至同租户误配 aud）签发的
      // token 不得跨应用复用
      ...(env.ACCESS_TEAM_DOMAIN ? { issuer: `https://${env.ACCESS_TEAM_DOMAIN}` } : {}),
    });
    const email = typeof result.payload.email === 'string' ? result.payload.email.toLowerCase() : '';
    // 白名单漏配（未设置/全空白）= 后台对全团队开放，必须 fail closed
    const allowed = (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    return email && allowed.length > 0 && allowed.includes(email) ? { email } : null;
  } catch {
    return null;
  }
}
