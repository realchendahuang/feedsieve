import { describe, expect, it } from 'vitest';
import { hashInstallationId } from '../src/lib/hash';

describe('installationId 加盐哈希', () => {
  it('salt >= 16 位时正常出盐', async () => {
    const hash = await hashInstallationId('0123456789abcdef', 'install-1');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // 盐进消息：同 id 不同盐哈希不同
    const otherSalt = await hashInstallationId('fedcba9876543210', 'install-1');
    expect(hash).not.toBe(otherSalt);
  });

  it('salt 缺失/过短 fail closed：无盐哈希可离线穷举，绝不静默退化', async () => {
    await expect(hashInstallationId(undefined as unknown as string, 'install-1')).rejects.toThrow(
      'installation_salt_missing',
    );
    await expect(hashInstallationId('short-salt', 'install-1')).rejects.toThrow(
      'installation_salt_missing',
    );
  });
});
