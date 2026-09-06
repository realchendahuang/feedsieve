#!/usr/bin/env node
/**
 * 一次性生成发布者签名密钥（Ed25519）。
 *
 * 私钥从不进仓库（写入 gitignored 的 .secrets/signing-key.pkcs8.base64）；
 * 公钥需要加进 packages/community-lists/src/trusted-keys.ts 才会被扩展信任。
 *
 * 用法：node scripts/keygen.mjs [key_id]
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const keyId = process.argv[2] ?? `release-${Math.floor(Date.now() / 1000)}`;

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const spki = publicKey.export({ type: 'spki', format: 'der' });
// Ed25519 SPKI = 12 字节 AlgorithmIdentifier + 32 字节原始公钥
const publicKeyB64 = spki.subarray(spki.length - 32).toString('base64');

const keyFile = fileURLToPath(new URL('../.secrets/signing-key.pkcs8.base64', import.meta.url));
await mkdir(new URL('../.secrets/', import.meta.url), { recursive: true });
await writeFile(keyFile, `${privateKeyB64}\n`);

console.log(`key_id:       ${keyId}`);
console.log(`public key:   ${publicKeyB64}`);
console.log(`private key:  ${keyFile}（gitignored，绝不提交）`);
console.log('');
console.log('1) 把 public key 加进 packages/community-lists/src/trusted-keys.ts');
console.log('   （轮换场景新增 key_id；首发直接替换 release-1 即可）');
console.log('2) 快照签名：把私钥写进 apps/community-api/.dev.vars 和');
console.log('   wrangler.local.jsonc 的 SIGNING_PRIVATE_KEY，SIGNING_KEY_ID=release-1');
console.log('3) 词库签名：build-keyword-packs.mjs 会自动读取 .secrets 下的密钥文件');