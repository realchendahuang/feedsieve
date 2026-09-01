/**
 * 社区贡献上报（Phase F；v0.4 载荷扩容）。
 *
 * 没有逐条弹窗。用户明确维护的本地黑名单与白名单在总开关开启时同步；
 * 黑名单作为正样本，白名单作为负样本。绝不上传浏览历史或推文原文。
 *
 * 网络失败进本地积压队列，由 background 在启动时补交（尽力而为）。
 */
import { COMMUNITY_API_BASE, getCommunitySettings } from './community-store';
import { getAllowlist, type FalsePositiveEvidence } from './allowlist';
import { getBlockedAccounts } from './blocked-accounts';

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
const LABEL_SYNC_STATE_KEY = 'communityLabelSyncStateV1';
const MAX_BATCH = 50;

type LocalLabel =
  | {
      label: 'blocked';
      handle: string;
      labeledAt: number;
      xUserId?: string;
      category: string;
      contentFingerprint?: string;
      linkDomains?: string[];
    }
  | {
      label: 'allowed';
      handle: string;
      labeledAt: number;
      xUserId?: string;
      detectionSource?: string;
      ruleId?: string;
      detectionReason?: string;
    };

export interface LabelSyncSummary {
  blocked: number;
  allowed: number;
  retracted: number;
  pending: number;
}

let runningLabelSync: Promise<LabelSyncSummary> | null = null;

/**
 * 本机匿名安装 ID：首次使用时生成随机 UUID，服务端只存加盐哈希。
 * 只在主动路径调用（贡献上报 / 复制 ID 按钮）；被动查询走 peekInstallationId。
 */
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

/** 只读安装 ID：存在则返回，绝不生成、绝不发请求。 */
export async function peekInstallationId(): Promise<string | null> {
  const result = await browser.storage.local.get(INSTALLATION_KEY);
  const existing = result[INSTALLATION_KEY];
  return typeof existing === 'string' && existing.length >= 8 ? existing : null;
}

/** 我的社区标签统计：当前黑名单 / 白名单 / 被采纳数。纯数字，无账号信息。 */
export interface ContributionStats {
  reports: number;
  rescues: number;
  adopted: number;
}

export async function getContributionStats(): Promise<ContributionStats | null> {
  try {
    const installationId = await peekInstallationId();
    // 本机从未同步过名单（无安装 ID）：零网络请求
    if (!installationId) {
      return null;
    }
    // POST body：原始 UUID 不进 URL，避免边缘/访问日志暂存
    const response = await fetch(`${COMMUNITY_API_BASE}/v1/contributions/stats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId }),
    });
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

/** 拉黑成功后调用；本地黑名单本身就是可重试队列，网络失败不会丢票。 */
export function contributeBlocks(items: ContributionItem[]): void {
  if (items.length > 0) {
    void syncLocalLabels();
  }
}

/** background 启动时先兼容补交旧版积压，再同步完整本地黑白名单。 */
export async function flushContributions(): Promise<void> {
  const settings = await getCommunitySettings();
  if (!settings.autoContribute) {
    return;
  }
  let backlog = await getBacklog();
  if (backlog.length > 0) {
    const installationId = await getInstallationId();
    const version = browser.runtime.getManifest().version;
    while (backlog.length > 0) {
      const batch = backlog.slice(0, MAX_BATCH);
      try {
        const response = await fetch(`${COMMUNITY_API_BASE}/v1/reports`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            installation_id: installationId,
            client_version: version,
            reports: batch.map(reportPayload),
          }),
        });
        if (!response.ok) {
          break;
        }
        backlog = backlog.slice(batch.length);
        await browser.storage.local.set({ [BACKLOG_KEY]: backlog });
      } catch {
        break;
      }
    }
  }
  await syncLocalLabels();
}

/**
 * 抢救票（v0.3）：认为社区标注可能误伤时显式投票。
 * 显式动作，但仍尊重 autoContribute 总开关（关 = 不参与社区）。
 */
export async function rescueHandle(
  handle: string,
  evidence?: FalsePositiveEvidence,
  xUserId?: string,
): Promise<boolean> {
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
        rescues: [
          {
            handle,
            ...(xUserId ? { x_user_id: xUserId } : {}),
            ...(evidence?.detectionSource ? { detection_source: evidence.detectionSource } : {}),
            ...(evidence?.ruleId ? { rule_id: evidence.ruleId } : {}),
            ...(evidence?.detectionReason ? { detection_reason: evidence.detectionReason } : {}),
          },
        ],
      }),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as {
      results?: { status?: string }[];
    };
    const status = body.results?.[0]?.status;
    // unknown = 纠错证据已入 rescues，但该账号尚不在社区 accounts 表。
    // 对本地启发式误标来说这是正常成功状态，不应向用户显示“失败”。
    return status === 'recorded' || status === 'duplicate' || status === 'unknown';
  } catch {
    return false;
  }
}

/**
 * 同步当前本地判断：黑名单是正样本，白名单是负样本。
 * - 升级后会补传历史记录；旧黑名单没有分类时使用 other。
 * - 同一 handle 同时存在于两边时，以时间较新的本地动作作为当前判断。
 * - 已同步记录从本地名单删除后，撤回当前票，但服务端保留原始审计证据。
 */
export function syncLocalLabels(): Promise<LabelSyncSummary> {
  if (!runningLabelSync) {
    runningLabelSync = runLocalLabelSync().finally(() => {
      runningLabelSync = null;
    });
  }
  return runningLabelSync;
}

async function runLocalLabelSync(): Promise<LabelSyncSummary> {
  const summary: LabelSyncSummary = { blocked: 0, allowed: 0, retracted: 0, pending: 0 };
  const settings = await getCommunitySettings();
  const desired = await collectLocalLabels();
  if (!settings.autoContribute) {
    summary.pending = desired.size;
    return summary;
  }

  const state = await getLabelSyncState();
  const pending = [...desired.values()].filter(
    (label) => state[label.handle] !== labelSignature(label),
  );
  const retractions = Object.keys(state).filter((handle) => !desired.has(handle));
  if (pending.length === 0 && retractions.length === 0) {
    return summary;
  }

  const installationId = await getInstallationId();
  const version = browser.runtime.getManifest().version;

  for (const batch of chunk(
    pending.filter(
      (label): label is Extract<LocalLabel, { label: 'blocked' }> => label.label === 'blocked',
    ),
  )) {
    const successful = await postLabelBatch(
      '/v1/reports',
      {
        installation_id: installationId,
        client_version: version,
        reports: batch.map((label) =>
          reportPayload({
            handle: label.handle,
            xUserId: label.xUserId,
            category: label.category,
            contentFingerprint: label.contentFingerprint,
            linkDomains: label.linkDomains,
          }),
        ),
      },
      new Set(['recorded', 'duplicate']),
    );
    for (const label of batch) {
      if (successful.has(label.handle)) {
        state[label.handle] = labelSignature(label);
        summary.blocked++;
      }
    }
    await setLabelSyncState(state);
    if (successful.size < batch.length) break;
  }

  for (const batch of chunk(
    pending.filter(
      (label): label is Extract<LocalLabel, { label: 'allowed' }> => label.label === 'allowed',
    ),
  )) {
    const successful = await postLabelBatch(
      '/v1/rescues',
      {
        installation_id: installationId,
        client_version: version,
        rescues: batch.map((label) => ({
          handle: label.handle,
          ...(label.xUserId ? { x_user_id: label.xUserId } : {}),
          ...(label.detectionSource ? { detection_source: label.detectionSource } : {}),
          ...(label.ruleId ? { rule_id: label.ruleId } : {}),
          ...(label.detectionReason ? { detection_reason: label.detectionReason } : {}),
        })),
      },
      new Set(['recorded', 'duplicate', 'unknown']),
    );
    for (const label of batch) {
      if (successful.has(label.handle)) {
        state[label.handle] = labelSignature(label);
        summary.allowed++;
      }
    }
    await setLabelSyncState(state);
    if (successful.size < batch.length) break;
  }

  for (const batch of chunk(retractions)) {
    const successful = await postLabelBatch(
      '/v1/labels/retract',
      { installation_id: installationId, handles: batch },
      new Set(['retracted', 'absent']),
    );
    for (const handle of batch) {
      if (successful.has(handle)) {
        delete state[handle];
        summary.retracted++;
      }
    }
    await setLabelSyncState(state);
    if (successful.size < batch.length) break;
  }

  summary.pending =
    [...desired.values()].filter((label) => state[label.handle] !== labelSignature(label)).length +
    Object.keys(state).filter((handle) => !desired.has(handle)).length;
  return summary;
}

async function collectLocalLabels(): Promise<Map<string, LocalLabel>> {
  const [blocked, allowed] = await Promise.all([getBlockedAccounts(), getAllowlist()]);
  const labels = new Map<string, LocalLabel>();
  for (const item of blocked) {
    labels.set(item.handle, {
      label: 'blocked',
      handle: item.handle,
      labeledAt: item.blockedAt,
      ...(item.xUserId ? { xUserId: item.xUserId } : {}),
      category: item.category ?? 'other',
      ...(item.contentFingerprint ? { contentFingerprint: item.contentFingerprint } : {}),
      ...(item.linkDomains?.length ? { linkDomains: item.linkDomains } : {}),
    });
  }
  for (const item of allowed) {
    const existing = labels.get(item.handle);
    if (existing && existing.labeledAt > item.addedAt) {
      continue;
    }
    labels.set(item.handle, {
      label: 'allowed',
      handle: item.handle,
      labeledAt: item.addedAt,
      ...(item.xUserId ? { xUserId: item.xUserId } : {}),
      ...(item.detectionSource ? { detectionSource: item.detectionSource } : {}),
      ...(item.ruleId ? { ruleId: item.ruleId } : {}),
      ...(item.detectionReason ? { detectionReason: item.detectionReason } : {}),
    });
  }
  return labels;
}

function labelSignature(label: LocalLabel): string {
  return JSON.stringify(
    label.label === 'blocked'
      ? [
          label.label,
          label.xUserId ?? '',
          label.category,
          label.contentFingerprint ?? '',
          [...(label.linkDomains ?? [])].sort(),
        ]
      : [
          label.label,
          label.xUserId ?? '',
          label.detectionSource ?? '',
          label.ruleId ?? '',
          label.detectionReason ?? '',
        ],
  );
}

async function postLabelBatch(
  path: string,
  body: Record<string, unknown>,
  acceptedStatuses: ReadonlySet<string>,
): Promise<Set<string>> {
  try {
    const response = await fetch(`${COMMUNITY_API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return new Set();
    const payload = (await response.json()) as {
      results?: Array<{ handle?: string; status?: string }>;
    };
    return new Set(
      (payload.results ?? [])
        .filter(
          (result): result is { handle: string; status: string } =>
            typeof result.handle === 'string' &&
            typeof result.status === 'string' &&
            acceptedStatuses.has(result.status),
        )
        .map((result) => result.handle.replace(/^@+/, '').toLowerCase()),
    );
  } catch {
    return new Set();
  }
}

function reportPayload(item: ContributionItem): Record<string, unknown> {
  return {
    handle: item.handle,
    ...(item.xUserId ? { x_user_id: item.xUserId } : {}),
    reason: item.category,
    ...(item.contentFingerprint ? { content_fingerprint: item.contentFingerprint } : {}),
    ...(item.linkDomains?.length ? { link_domains: item.linkDomains } : {}),
  };
}

function chunk<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_BATCH) {
    batches.push(items.slice(i, i + MAX_BATCH));
  }
  return batches;
}

async function getLabelSyncState(): Promise<Record<string, string>> {
  const result = await browser.storage.local.get(LABEL_SYNC_STATE_KEY);
  const value = result[LABEL_SYNC_STATE_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function setLabelSyncState(state: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ [LABEL_SYNC_STATE_KEY]: state });
}

async function getBacklog(): Promise<ContributionItem[]> {
  const result = await browser.storage.local.get(BACKLOG_KEY);
  const value = result[BACKLOG_KEY];
  return Array.isArray(value) ? (value as ContributionItem[]) : [];
}
