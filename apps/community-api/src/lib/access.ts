import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AccessIdentity { email: string }

export async function verifyAccess(request: Request, env: Cloudflare.Env): Promise<AccessIdentity | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_AUD || !env.ACCESS_JWKS_URL) return null;
  try {
    const jwks = createRemoteJWKSet(new URL(env.ACCESS_JWKS_URL));
    const result = await jwtVerify(token, jwks, { audience: env.ACCESS_AUD });
    const email = typeof result.payload.email === 'string' ? result.payload.email.toLowerCase() : '';
    const allowed = (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    return email && (allowed.length === 0 || allowed.includes(email)) ? { email } : null;
  } catch {
    return null;
  }
}
