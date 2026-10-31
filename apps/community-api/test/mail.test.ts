import { describe, expect, it } from 'vitest';
import { hashEmail, isValidEmail, normalizeEmail, verificationCodeEmailHtml } from '../src/mail';

describe('邮箱工具', () => {
  it('Gmail 别名归一：+tag 与加点变体视为同一邮箱', () => {
    expect(normalizeEmail('alice+tag@googlemail.com')).toBe('alice@gmail.com');
    expect(normalizeEmail(' A.L.I.C.E@Gmail.com ')).toBe('alice@gmail.com');
    expect(normalizeEmail('user+x@example.com')).toBe('user@example.com');
    // 非 Gmail 不去点
    expect(normalizeEmail('a.b@example.com')).toBe('a.b@example.com');
  });

  it('邮箱格式校验', () => {
    expect(isValidEmail('a@example.com')).toBe(true);
    expect(isValidEmail('no-at.example.com')).toBe(false);
    expect(isValidEmail('a@b.c')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });

  it('邮箱哈希加盐；盐缺失 fail closed', async () => {
    const hash = await hashEmail('0123456789abcdef', 'a@example.com');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashEmail('fedcba9876543210', 'a@example.com')).not.toBe(hash);
    await expect(hashEmail('', 'a@example.com')).rejects.toThrow('installation_salt_missing');
  });

  it('验证码邮件模板转义验证码并标注有效期', () => {
    const html = verificationCodeEmailHtml('<123>');
    expect(html).toContain('&lt;123&gt;');
    expect(html).not.toContain('<123>');
    expect(html).toContain('10 分钟内有效');
  });
});
