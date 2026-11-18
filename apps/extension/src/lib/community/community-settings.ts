/**
 * 社区名单轻量子模块：用户设置、API 端点与官方暂停实时门控。
 *
 * 刻意与 snapshot 解析 / buildIndex / @feedsieve/community-lists validate 解耦：
 * content script 与轻量模块只从这里读写设置和发门控 IPC，避免每个 X 标签页都把
 * parseSnapshotBody（以及连带的大体量校验代码）打进首屏脚本。
 */
import {
  DEFAULT_MARK_STRENGTH,
  isMarkStrength,
  type MarkStrength,
} from '@feedsieve/community-lists';
import { API_BASE } from '../platform/api-base';

export const COMMUNITY_API_BASE = API_BASE;
export const SNAPSHOT_KEY = 'communitySnapshotV2';
export const LEGACY_SNAPSHOT_KEY = 'communitySnapshot';
export const SETTINGS_KEY = 'communitySettings';

export interface CommunitySettings {
  /** 社区名单总开关（关掉后只跑启发式 + 内置名单） */
  enabled: boolean;
  /** 识别灵敏度：清爽 / 标准 / 大扫除 */
  strength: MarkStrength;
  /**
   * 同步用户明确维护的本地黑名单/白名单（默认开，全局开关，绝无逐条弹窗）。
   * 黑名单上传 handle / 可选 x_user_id / 分类 / 话术指纹哈希 / 外链域名；
   * 白名单上传 handle / 可选 x_user_id / 当时的检测来源、规则与理由。
   * 不上传浏览历史、推文原文或任何被动页面记录。
   */
  autoContribute: boolean;
  /**
   * 参与全站热榜（默认开；「仅本地运行」打开时一并停止）：上报浏览时 X 已加载的公开帖子指标，
   * 不带安装 ID 和自己的 X 账号，见 src/lib/insight/hot-uplink.ts。
   */
  hotContribute: boolean;
  /**
   * 上报规则命中（默认开；「仅本地运行」打开时一并停止）：本地规则打了黄框的账号和规则 ID，
   * 匿名报给服务器做误伤统计与佐证，不是票，见 src/lib/community/rule-hit-uplink.ts。
   */
  hitContribute: boolean;
}

export const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  enabled: true,
  strength: DEFAULT_MARK_STRENGTH,
  autoContribute: true,
  hotContribute: true,
  hitContribute: true,
};

export async function getCommunitySettings(): Promise<CommunitySettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const value = (result[SETTINGS_KEY] ?? {}) as Record<string, unknown>;
  return {
    enabled: value['enabled'] !== false,
    strength: isMarkStrength(value['strength']) ? value['strength'] : DEFAULT_MARK_STRENGTH,
    autoContribute: value['autoContribute'] !== false,
    hotContribute: value['hotContribute'] !== false,
    hitContribute: value['hitContribute'] !== false,
  };
}

export async function setCommunitySettings(
  patch: Partial<CommunitySettings>,
): Promise<CommunitySettings> {
  const next = { ...(await getCommunitySettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function subscribeCommunity(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && (changes[SNAPSHOT_KEY] || changes[SETTINGS_KEY])) {
      onChange();
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

/** 官方暂停开关实时状态：browser 侧所有破坏性操作门控用的统一形状。 */
export type OfficialPauseState =
  | { destructive_actions_disabled: true; reason?: string; disabled_since?: string }
  | { destructive_actions_disabled: false };

/**
 * 轻量回退：仅当 background SW 不可达时从 storage.local 快照读 kill_switch 字段，
 * 不经 validate/parseSnapshotBody 全量校验（只会保守暂停，绝不会凭空放行）。
 */
async function getStoredKillSwitchLight(): Promise<OfficialPauseState> {
  try {
    const result = await browser.storage.local.get(SNAPSHOT_KEY);
    const stored = result[SNAPSHOT_KEY] as { body?: unknown } | undefined;
    if (!stored || typeof stored.body !== 'string') {
      return { destructive_actions_disabled: false };
    }
    const parsed = JSON.parse(stored.body) as {
      kill_switch?: {
        destructive_actions_disabled?: unknown;
        reason?: unknown;
        disabled_since?: unknown;
      };
    };
    const ks = parsed?.kill_switch;
    if (ks?.destructive_actions_disabled === true) {
      return {
        destructive_actions_disabled: true,
        ...(typeof ks.reason === 'string' ? { reason: ks.reason } : {}),
        ...(typeof ks.disabled_since === 'string' ? { disabled_since: ks.disabled_since } : {}),
      };
    }
  } catch {
    // 损坏或解析异常：仅作降级，不阻塞正常恢复
  }
  return { destructive_actions_disabled: false };
}

/**
 * 破坏性操作执行前的实时门控：问 background 读 /v1/kill-switch
 * （SW 内做 30s TTL 缓存，批量队列突发只产生一次请求）。
 * 网络/消息失败回退到本地快照里的开关 —— 只会更保守，不会凭空放行。
 */
export async function requestOfficialPauseCheck(): Promise<OfficialPauseState> {
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'feedsieve:official-pause-check',
    })) as { paused?: unknown; reason?: string; disabledSince?: string } | null | undefined;
    if (res && typeof res.paused === 'boolean') {
      return res.paused
        ? {
            destructive_actions_disabled: true,
            reason: res.reason,
            disabled_since: res.disabledSince,
          }
        : { destructive_actions_disabled: false };
    }
  } catch {
    // background SW 暂不可达：走本地快照回退
  }
  return getStoredKillSwitchLight();
}
