/**
 * 社区贡献上报（Phase F；v0.4 载荷扩容）。
 *
 * 摩擦设计（用户拍板）：没有逐条弹窗。拉黑成功即自动上报，
 * 全局开关 autoContribute 默认开，关一次永远不打扰。
 * 隐私红线：只在用户主动拉黑成功后上报；payload 仅
 * handle / x_user_id / 分类 / 匿名安装哈希 / 版本号，
 * 外加 v0.4 内容证据 —— 话术指纹（归一化文本的单向哈希，原文不出设备）
 * 与该推文外链域名（仅 hostname）。绝无浏览数据。
 *
 * 网络失败进本地积压队列，由 background 在启动时补交（尽力而为）。
 */
import {
  COMMUNITY_API_BASE,
  getCommunitySettings,
} from './community-store';

export interface ContributionItem {
  handle: string;
  xUserId?: string;
  /** 贡献分类（detect 来源自动推导，用户无感知） */
  category: string;
  /** 话术指纹（v0.4）：detector.contentFingerprint 的输出，16 位 hex */
  contentFingerprint?: string;
  /** 外链 hostname（v0.4）：已去自家域名并去重 */
  linkDomains?: string[];
}

/** X 自家/媒体域名：无垃圾识别价值，不进指纹库也不随上报发送 */
const SELF_DOMAINS = ['x.com', 'twitter.com', 't.co', 'twimg.com'];

export function isSelfDomain(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return SELF_DOMAINS.some((d) => lower === d || lower.endsWith(`.${d}`));
}

/** 从推文链接收集上报用域名：去自家、去重、封顶（与服务端限额一致） */
export function collectLinkDomains(
  links: ReadonlyArray<{ hostname?: string }>,
): string[] | undefined {
  const domains: string[] = [];
  for (const link of links) {
    if (!link.hostname || isSelfDomain(link.hostname)) {
      continue;
    }
    const hostname = link.hostname.toLowerCase();
    if (!domains.includes(hostname)) {
      domains.push(hostname);
    }
    if (domains.length >= 5) {
      break;
    }
  }
  return domains.length > 0 ? domains : undefined;
}

const INSTALLATION_KEY = 'installationId';
const BACKLOG_KEY = 'pendingContributions';
const MAX_BACKLOG = 500;

/** 本机匿名安装 ID：首次使用时生成随机 UUID，服务端只存加盐哈希。 */
export async function getInstallationId(): Promise<string> {
  const result = await browser.storage.local.get(INSTALLATION_KEY);
  const existing = result[INSTALLATION_KEY];
  if (typeof existing === 'string' && existing.length >= 8) {
    return existing;
  }
  const created = crypto.randomUUID();
  await browser.storage.local.set({ [INSTALLATION_KEY]: created });
  return created;
}

/** 我的社区贡献统计（v0.6）：累计上报 / 被采纳 / 抢救数。纯数字，无账号信息。 */
export interface ContributionStats {
  reports: number;
  rescues: number;
  adopted: number;
}

export async function getContributionStats(): Promise<ContributionStats | null> {
  try {
    const installationId = await getInstallationId();
    const response = await fetch(
      `${COMMUNITY_API_BASE}/v1/contributions/stats?installation_id=${encodeURIComponent(installationId)}`,
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Partial<ContributionStats>;
    return {
      reports: Number(body.reports) || 0,
      rescues: Number(body.rescues) || 0,
      adopted: Number(body.adopted) || 0,
    };
  } catch {
    return null; // 网络失败静默：战报不因统计不可用而崩
  }
}

/** detect 结果 -> 上报分类（用户零输入） */
export function categoryFromDetection(
  source: string,
  ruleId: string | null | undefined,
  communityCategory?: string,
): string {
  if (source !== 'heuristic') {
    // v0.4 内容证据来源：没有对应名单条目，按证据类型定分类
    if (source === 'fingerprint') {
      return 'copy_paste';
    }
    if (source === 'domain') {
      return 'scam_phishing';
    }
    return communityCategory ?? 'other';
  }
  switch (ruleId) {
    case 'porn-bait-zh':
      return 'adult_gray_traffic';
    case 'default-name-digits':
      return 'bot_spam';
    case 'spam-link-hint':
      return 'scam_phishing';
    case 'templated-text':
      return 'copy_paste';
    default:
      return 'other';
  }
}

/** 拉黑成功后调用；开关关闭时静默跳过，失败静默进积压。绝不抛错打扰拉黑主流程。 */
export function contributeBlocks(items: ContributionItem[]): void {
  void (async () => {
    try {
      if (items.length === 0) {
        return;
      }
      const settings = await getCommunitySettings();
      if (!settings.autoContribute) {
        return;
      }
      const installationId = await getInstallationId();
      const version = browser.runtime.getManifest().version;
      const response = await fetch(`${COMMUNITY_API_BASE}/v1/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installation_id: installationId,
          client_version: version,
          reports: items.map((item) => ({
            handle: item.handle,
            ...(item.xUserId ? { x_user_id: item.xUserId } : {}),
            reason: item.category,
            ...(item.contentFingerprint
              ? { content_fingerprint: item.contentFingerprint }
              : {}),
            ...(item.linkDomains?.length
              ? { link_domains: item.linkDomains }
              : {}),
          })),
        }),
      });
      if (!response.ok) {
        await pushBacklog(items);
      }
    } catch {
      await pushBacklog(items).catch(() => {
        // 积压也失败：放弃本批，不影响用户
      });
    }
  })();
}

/** background 启动时补交积压的上报。 */
export async function flushContributions(): Promise<void> {
  const backlog = await getBacklog();
  if (backlog.length === 0) {
    return;
  }
  const settings = await getCommunitySettings();
  if (!settings.autoContribute) {
    return;
  }
  const installationId = await getInstallationId();
  const version = browser.runtime.getManifest().version;
  try {
    const response = await fetch(`${COMMUNITY_API_BASE}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        client_version: version,
        reports: backlog.map((item) => ({
          handle: item.handle,
          ...(item.xUserId ? { x_user_id: item.xUserId } : {}),
          reason: item.category,
          ...(item.contentFingerprint
            ? { content_fingerprint: item.contentFingerprint }
            : {}),
          ...(item.linkDomains?.length
            ? { link_domains: item.linkDomains }
            : {}),
        })),
      }),
    });
    if (response.ok) {
      await browser.storage.local.set({ [BACKLOG_KEY]: [] });
    }
  } catch {
    // 网络仍不可用：下次启动再试
  }
}

/**
 * 抢救票（v0.3）：认为社区标注可能误伤时显式投票。
 * 显式动作，但仍尊重 autoContribute 总开关（关 = 不参与社区）。
 */
export async function rescueHandle(handle: string): Promise<boolean> {
  try {
    const settings = await getCommunitySettings();
    if (!settings.autoContribute) {
      return false;
    }
    const installationId = await getInstallationId();
    const version = browser.runtime.getManifest().version;
    const response = await fetch(`${COMMUNITY_API_BASE}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        client_version: version,
        rescues: [{ handle }],
      }),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as {
      results?: { status?: string }[];
    };
    const status = body.results?.[0]?.status;
    return status === 'recorded' || status === 'duplicate';
  } catch {
    return false;
  }
}

async function getBacklog(): Promise<ContributionItem[]> {
  const result = await browser.storage.local.get(BACKLOG_KEY);
  const value = result[BACKLOG_KEY];
  return Array.isArray(value) ? (value as ContributionItem[]) : [];
}

async function pushBacklog(items: ContributionItem[]): Promise<void> {
  const backlog = await getBacklog();
  const merged = [...backlog, ...items].slice(-MAX_BACKLOG);
  await browser.storage.local.set({ [BACKLOG_KEY]: merged });
}
