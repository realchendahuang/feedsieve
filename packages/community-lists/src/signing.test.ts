import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  buildSigningMessage,
  bytesToBase64,
  compareManifestVersions,
  signManifestMessage,
  verifyManifestSignature,
  type ManifestSignature,
} from './signing';
// 仓库侧构建脚本的复刻实现：一致性测试钉死它不会与模块漂移
import { buildKeywordPackManifestMessage } from '../../../scripts/signing-message.mjs';

describe('buildSigningMessage（签名消息）', () => {
  it('仓库脚本的 buildKeywordPackManifestMessage 与本模块逐字节一致', () => {
    const cases: Array<{ version: string; generatedAt: string | null; sha256: string; rules: number }> = [
      { version: '2026.09.07.1', generatedAt: '2026-09-07T06:12:45Z', sha256: 'abc123', rules: 778 },
      { version: '2026.01.01.0001', generatedAt: null, sha256: '0'.repeat(64), rules: 0 },
      { version: '2025.12.31.999', generatedAt: 'null', sha256: 'deadbeef', rules: 1 },
    ];
    for (const c of cases) {
      expect(
        buildKeywordPackManifestMessage(c.version, c.generatedAt, c.sha256, c.rules),
      ).toBe(
        buildSigningMessage({
          schemaVersion: 1,
          version: c.version,
          generatedAt: c.generatedAt,
          files: [{ path: 'official.json', sha256: c.sha256, count: c.rules }],
        }),
      );
    }
  });

  it('generated_at 为 null 时序列化为空串（与 Worker 侧签名行为一致）', () => {
    // Array.join 把 null 元素转为空串：null 与空串输入必须产出相同消息
    expect(
      buildSigningMessage({
        schemaVersion: 1,
        version: '2026.09.07.1',
        generatedAt: null,
        files: [{ path: 'official.json', sha256: 'abc', count: 1 }],
      }),
    ).toBe(
      buildSigningMessage({
        schemaVersion: 1,
        version: '2026.09.07.1',
        generatedAt: '',
        files: [{ path: 'official.json', sha256: 'abc', count: 1 }],
      }),
    );
  });

  it('文件清单按 path 排序、字段顺序固定', () => {
    const message = buildSigningMessage({
      schemaVersion: 1,
      version: 'v',
      generatedAt: null,
      files: [
        { path: 'b.json', sha256: 'bb', count: 2 },
        { path: 'a.json', sha256: 'aa', count: 1 },
      ],
    });
    expect(message).toBe(
      ['feedsieve-manifest-v1', '1', 'v', '', 'a.json', 'aa', '1', 'b.json', 'bb', '2'].join('\n'),
    );
  });
});

describe('verifyManifestSignature / signManifestMessage（Ed25519 验签与签名）', () => {
  it('真实密钥对往返：签名可验证，篡改消息后验签失败', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    );
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    );
    const rawPublic = new Uint8Array(
      await crypto.subtle.exportKey('raw', keyPair.publicKey),
    );
    const trustedKeys = [{ key_id: 'test-key', publicKeyBase64: bytesToBase64(rawPublic) }];
    const message = buildSigningMessage({
      schemaVersion: 1,
      version: '2026.09.07.1',
      generatedAt: null,
      files: [{ path: 'official.json', sha256: 'abc', count: 10 }],
    });

    const signature = await signManifestMessage(message, bytesToBase64(pkcs8), 'test-key');
    expect(await verifyManifestSignature(message, signature, trustedKeys)).toEqual({ ok: true });
    // 篡改被签名字段（版本号）：验签必须失败
    const tampered = message.replace('2026.09.07.1', '2026.09.07.2');
    expect(await verifyManifestSignature(tampered, signature, trustedKeys)).toEqual({
      ok: false,
      error: 'signature_invalid',
    });
  });

  it('错误 alg / 未知 key_id / 签名长度非 64 字节 / 公钥非法一律拒绝', async () => {
    const trustedKeys = [{ key_id: 'k1', publicKeyBase64: bytesToBase64(new Uint8Array(32)) }];
    const badAlg = {
      key_id: 'k1',
      alg: 'rsa',
      sig: 'x'.repeat(88),
    } as unknown as ManifestSignature;
    expect(await verifyManifestSignature('msg', badAlg, trustedKeys)).toEqual({
      ok: false,
      error: 'unknown_key',
    });
    const unknownKey: ManifestSignature = { key_id: 'nope', alg: 'ed25519', sig: 'x'.repeat(88) };
    expect(await verifyManifestSignature('msg', unknownKey, trustedKeys)).toEqual({
      ok: false,
      error: 'unknown_key',
    });
    const shortSig: ManifestSignature = { key_id: 'k1', alg: 'ed25519', sig: 'x'.repeat(86) };
    expect(await verifyManifestSignature('msg', shortSig, trustedKeys)).toEqual({
      ok: false,
      error: 'signature_invalid',
    });
    const badKey = [{ key_id: 'k1', publicKeyBase64: '!!!not-base64!!!' }];
    const anySig: ManifestSignature = { key_id: 'k1', alg: 'ed25519', sig: 'x'.repeat(88) };
    expect(await verifyManifestSignature('msg', anySig, badKey)).toEqual({
      ok: false,
      error: 'signature_invalid',
    });
  });

  it('signManifestMessage：私钥 base64 非法或 PKCS8 截断时抛错', async () => {
    await expect(signManifestMessage('msg', 'not-base64!!', 'k1')).rejects.toThrow(
      'invalid_private_key',
    );
    // 合法 base64 但长度截断的 DER：importKey 会失败
    await expect(signManifestMessage('msg', 'AAAA', 'k1')).rejects.toThrow();
  });
});

describe('compareManifestVersions（版本比较）', () => {
  it('按 YYYY.MM.DD.N 数值元组比较；非法格式防御性返回 0', () => {
    expect(compareManifestVersions('2026.09.07.1', '2026.09.07.2')).toBe(-1);
    expect(compareManifestVersions('2026.09.08.1', '2026.09.07.24')).toBe(1);
    expect(compareManifestVersions('2026.09.07.24', '2026.09.07.24')).toBe(0);
    // 数值比较而非字典序：.9 > .0008（备用位不受长度影响）
    expect(compareManifestVersions('2026.09.07.9', '2026.09.07.0008')).toBe(1);
    // 非法格式返回 0（调用方已用 schema 校验拒绝，这里是兜底）
    expect(compareManifestVersions('not-a-version', '2026.09.07.1')).toBe(0);
    expect(compareManifestVersions('2026.09.07.1', '')).toBe(0);
  });
});

describe('base64ToBytes / bytesToBase64', () => {
  it('往返一致；非法输入返回 null', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes('!!!')).toBeNull();
    expect(base64ToBytes('abc')).toBeNull(); // 长度不是 4 的倍数
    expect(base64ToBytes('')).toBeNull(); // 空串不算合法 base64（断言至少 1 字符）
  });
});