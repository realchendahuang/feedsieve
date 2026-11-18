/**
 * 内容脚本侧的精简社区名单客户端：
 * - 启动/快照更新时向 background SW 请求一次 SlimCommunityPayload，只驻留查表集合。
 * - 不在标签页解析 3.5 MB+ 的 official.json、不驻留 6000+ 条完整 CommunityEntry 对象。
 * - 真正命中社区名单账号或 Campaign 指纹时，按微任务批量向 SW 查询那几个条目的完整解释，
 *   缓存并通知调用方平滑更新徽章理由与页面账本。
 */
import type { CommunityEntry } from '@feedsieve/community-lists';
import type { CommunitySettings } from './community-settings';
import type { RuntimeCommunity } from './community-store';
import {
  COMMUNITY_LOOKUP_MESSAGE,
  COMMUNITY_RUNTIME_MESSAGE,
  type CommunityLookupResponse,
  type CommunityRuntimeResponse,
} from './community-protocol';

export interface LoadedCommunityRuntime {
  community: RuntimeCommunity | null;
  builtinList: ReadonlySet<string>;
  settings: Pick<CommunitySettings, 'enabled' | 'strength' | 'autoContribute'>;
  requestEnrichment: (hit: { handle?: string; fingerprint?: string }) => void;
  dispose: () => void;
}

const MAX_LOOKUP_ATTEMPTS = 2;

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

export async function loadSlimCommunityRuntime(options: {
  send?: (message: unknown) => Promise<unknown>;
  onEnriched?: (handles: ReadonlySet<string>) => void;
} = {}): Promise<LoadedCommunityRuntime> {
  const send = options.send ?? ((message: unknown) => browser.runtime.sendMessage(message));
  const response = (await send({
    type: COMMUNITY_RUNTIME_MESSAGE,
  })) as CommunityRuntimeResponse | null | undefined;

  if (!response || typeof response.enabled !== 'boolean') {
    return {
      community: null,
      builtinList: new Set<string>(),
      settings: { enabled: true, strength: 'standard', autoContribute: true },
      requestEnrichment: () => {},
      dispose: () => {},
    };
  }

  const settings: Pick<CommunitySettings, 'enabled' | 'strength' | 'autoContribute'> = {
    enabled: response.enabled,
    strength: response.strength,
    autoContribute: response.autoContribute,
  };

  const payload = response.community;
  if (!settings.enabled || !payload) {
    return {
      community: null,
      builtinList: new Set(response.builtinHandles ?? []),
      settings,
      requestEnrichment: () => {},
      dispose: () => {},
    };
  }

  const handleSet = new Set(payload.handles);
  const builtinList: ReadonlySet<string> = response.builtinSameAsCommunity
    ? handleSet
    : new Set(response.builtinHandles ?? []);
  const verifiedSet = new Set(payload.verified);
  const whitelistSet = new Set(payload.whitelist);
  const fingerprintSet = new Set(payload.fingerprints);
  const domainSet = new Set(payload.domains);
  const mutedRules = new Set(payload.mutedRules);
  const campaignById = new Map<string, CommunityEntry>();
  const campaignByFingerprint = new Map<string, string>();

  const entryCache = new Map<string, CommunityEntry | null>();
  const resolvedFingerprints = new Set<string>();
  const handleAttempts = new Map<string, number>();
  const fingerprintAttempts = new Map<string, number>();

  const pendingHandles = new Set<string>();
  const pendingFingerprints = new Map<string, Set<string>>();
  const inFlightHandles = new Set<string>();
  const inFlightFingerprints = new Map<string, Set<string>>();

  let disposed = false;
  let flushScheduled = false;

  const index: RuntimeCommunity['index'] = {
    version: payload.version,
    size: handleSet.size,
    lookup(handle) {
      if (!handle) return null;
      return entryCache.get(normalizeHandle(handle)) ?? null;
    },
  };

  const community: RuntimeCommunity = {
    index,
    handleSet,
    verifiedSet,
    whitelistSet,
    fingerprintSet,
    domainSet,
    campaignById,
    campaignByFingerprint,
    version: payload.version,
    ...(payload.killSwitch ? { killSwitch: payload.killSwitch } : {}),
    mutedRules,
  };

  const addWaiter = (target: Map<string, Set<string>>, fp: string, handle?: string): void => {
    let waiters = target.get(fp);
    if (!waiters) {
      waiters = new Set<string>();
      target.set(fp, waiters);
    }
    if (handle) waiters.add(handle);
  };

  const flushLookup = (): void => {
    flushScheduled = false;
    if (disposed) return;

    const handles = [...pendingHandles];
    const fpWaiters = new Map<string, Set<string>>();
    for (const [fp, waiters] of pendingFingerprints) {
      fpWaiters.set(fp, new Set(waiters));
    }
    const fingerprints = [...fpWaiters.keys()];

    pendingHandles.clear();
    pendingFingerprints.clear();

    if (handles.length === 0 && fingerprints.length === 0) return;

    for (const h of handles) {
      inFlightHandles.add(h);
      handleAttempts.set(h, (handleAttempts.get(h) ?? 0) + 1);
    }
    for (const [fp, waiters] of fpWaiters) {
      const merged = inFlightFingerprints.get(fp) ?? new Set<string>();
      for (const h of waiters) merged.add(h);
      inFlightFingerprints.set(fp, merged);
      fingerprintAttempts.set(fp, (fingerprintAttempts.get(fp) ?? 0) + 1);
    }

    void Promise.resolve(
      send({
        type: COMMUNITY_LOOKUP_MESSAGE,
        version: payload.version,
        handles,
        fingerprints,
      }),
    )
      .then((raw) => {
        if (disposed) return;
        const lookupRes = raw as CommunityLookupResponse | null | undefined;
        if (!lookupRes || lookupRes.version !== payload.version) return;

        const enrichedHandles = new Set<string>();
        for (const h of handles) {
          const entry = lookupRes.entries?.[h] ?? null;
          entryCache.set(h, entry);
          if (entry) enrichedHandles.add(h);
        }

        for (const fp of fingerprints) {
          resolvedFingerprints.add(fp);
          const campaign = lookupRes.campaigns?.[fp] ?? null;
          if (campaign) {
            const key = campaign.campaign_entry_id ?? campaign.handle;
            campaignByFingerprint.set(fp, key);
            campaignById.set(key, campaign);
            for (const waiter of inFlightFingerprints.get(fp) ?? []) {
              enrichedHandles.add(waiter);
            }
          }
        }

        if (enrichedHandles.size > 0) {
          options.onEnriched?.(enrichedHandles);
        }
      })
      .catch(() => {
        // 后台 SW 偶发休眠或失败时维持基础「社区名单」标注，有重试预算时随下次扫描补齐
      })
      .finally(() => {
        for (const h of handles) inFlightHandles.delete(h);
        for (const fp of fingerprints) inFlightFingerprints.delete(fp);
      });
  };

  const scheduleFlush = (): void => {
    if (flushScheduled || disposed) return;
    flushScheduled = true;
    queueMicrotask(flushLookup);
  };

  const requestEnrichment = (hit: { handle?: string; fingerprint?: string }): void => {
    if (disposed) return;
    const normalized = hit.handle ? normalizeHandle(hit.handle) : '';
    let queued = false;

    if (
      normalized &&
      handleSet.has(normalized) &&
      !entryCache.has(normalized) &&
      !pendingHandles.has(normalized) &&
      !inFlightHandles.has(normalized) &&
      (handleAttempts.get(normalized) ?? 0) < MAX_LOOKUP_ATTEMPTS
    ) {
      pendingHandles.add(normalized);
      queued = true;
    }

    const fp = hit.fingerprint;
    if (
      fp &&
      !resolvedFingerprints.has(fp) &&
      (fingerprintAttempts.get(fp) ?? 0) < MAX_LOOKUP_ATTEMPTS
    ) {
      if (inFlightFingerprints.has(fp)) {
        if (normalized) addWaiter(inFlightFingerprints, fp, normalized);
      } else {
        addWaiter(pendingFingerprints, fp, normalized || undefined);
        queued = true;
      }
    }

    if (queued) scheduleFlush();
  };

  return {
    community,
    builtinList,
    settings,
    requestEnrichment,
    dispose: () => {
      disposed = true;
      pendingHandles.clear();
      pendingFingerprints.clear();
    },
  };
}
