/**
 * 扩展内置的发布者公钥（信任根）。私钥绝不进本仓库：
 * 快照签名私钥在社区 API 的部署配置（wrangler secret / gitignored wrangler.local.jsonc），
 * 词库签名私钥在本地 gitignored 的 .secrets/ 下（见 scripts/keygen.mjs）。
 *
 * 轮换流程：新公钥先随扩展版本发布（多 key 并存仍接受旧签名），
 * 等到旧 key 不再用于新发布后，再移除旧公钥并切换为单 key。
 */
import type { TrustedKey } from './signing';

export const TRUSTED_KEYS: readonly TrustedKey[] = [
  {
    key_id: 'release-1',
    publicKeyBase64: 'CJH7JfZZs3z2Iw9+hlCs0FWh8HoJmycx7UatXDVSnic=',
  },
];