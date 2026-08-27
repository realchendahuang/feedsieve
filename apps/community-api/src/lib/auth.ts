// 常数时间比较：先哈希再交给 workerd 的 timingSafeEqual，长度差也不泄露信息
export async function timingSafeEqualStr(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function checkBearerToken(
  authorization: string | undefined,
  expected: string,
): Promise<boolean> {
  const provided = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  return timingSafeEqualStr(provided, expected);
}
