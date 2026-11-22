/**
 * 后台 Service Worker 专属的社区名单索引服务：
 * - 单实例解析 3.5 MB+ 的官方快照并常驻/复用 CommunityIndex（避免每个 X 标签页各解析与驻留一份）。
 * - 对内容脚本只下发精简集合（handles / verified / whitelist / mutedRules；仅「大扫除」档才带 fingerprints / domains）。
 * - 内容脚本真正命中某个社区账号或指纹时，按批 IPC 查询该 1~N 个条目的完整元数据与 Campaign 信息。
 */
import { buildIndex, type CommunityEntry, type CommunityIndex } from '@feedsieve/community-lists';
import {
  COMMUNITY_LOOKUP_MESSAGE,
  COMMUNITY_RUNTIME_MESSAGE,
  type CommunityLookupResponse,
  type CommunityRuntimeResponse,
} from './community-protocol';
import { SNAPSHOT_KEY, getCommunitySettings } from './community-settings';
import { getBundledSnapshot, getCommunitySnapshot, parseStoredSnapshot } from './community-store';

interface CachedCommunityState {
  snapshotVersion: string;
  snapshotBody: string;
  index: CommunityIndex;
  handles: string[];
  verified: string[];
  whitelist: string[];
  mutedRules: string[];
  fingerprints: string[];
  domains: string[];
  campaignByFingerprint: Map<string, string>;
  campaignById: Map<string, CommunityEntry>;
  killSwitch?: {
    destructive_actions_disabled: true;
    reason?: string;
    disabled_since?: string;
  };
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

export function createCommunityWorker() {
  let generation = 0;
  let cachedState: CachedCommunityState | null | undefined;
  let inflightState: Promise<CachedCommunityState | null> | null = null;
  let bundledHandlesCache: { version: string; handles: string[] } | null | undefined;
  let inflightBundled: Promise<{ version: string; handles: string[] } | null> | null = null;

  function invalidate(): void {
    generation += 1;
    cachedState = undefined;
    inflightState = null;
  }

  async function loadCommunityState(): Promise<CachedCommunityState | null> {
    if (cachedState !== undefined) return cachedState;
    if (inflightState) return inflightState;

    const startedGen = generation;
    const promise = (async (): Promise<CachedCommunityState | null> => {
      const snapshot = await getCommunitySnapshot();
      if (!snapshot) {
        if (startedGen === generation) cachedState = null;
        return null;
      }
      const parsed = parseStoredSnapshot(snapshot.body);
      if (!parsed.ok) {
        if (startedGen === generation) cachedState = null;
        return null;
      }

      const value = parsed.value;
      const index = buildIndex(value);
      const handles: string[] = [];
      const fingerprintSet = new Set<string>();
      const domainSet = new Set<string>();
      const campaignByFingerprint = new Map<string, string>();
      const campaignById = new Map<string, CommunityEntry>();

      for (const entry of value.entries) {
        handles.push(entry.handle);
        for (const fp of entry.fingerprints ?? []) {
          fingerprintSet.add(fp);
          campaignByFingerprint.set(fp, entry.campaign_entry_id ?? entry.handle);
        }
        for (const domain of entry.domains ?? []) {
          domainSet.add(domain);
        }
        if (entry.campaign_entry_id && entry.campaign_size) {
          campaignById.set(entry.campaign_entry_id, entry);
        }
      }

      const next: CachedCommunityState = {
        snapshotVersion: value.snapshot_version,
        snapshotBody: snapshot.body,
        index,
        handles,
        verified: (value.verified ?? []).map((entry) => entry.handle),
        whitelist: (value.whitelist ?? []).map((entry) => entry.handle),
        mutedRules: [...(value.muted_rules ?? [])],
        fingerprints: [...fingerprintSet],
        domains: [...domainSet],
        campaignByFingerprint,
        campaignById,
        ...(value.kill_switch ? { killSwitch: value.kill_switch } : {}),
      };

      if (startedGen === generation) {
        cachedState = next;
      }
      return next;
    })().finally(() => {
      if (inflightState === promise) {
        inflightState = null;
      }
    });

    inflightState = promise;
    return promise;
  }

  async function loadBundledHandles(): Promise<{ version: string; handles: string[] } | null> {
    if (bundledHandlesCache !== undefined) return bundledHandlesCache;
    if (inflightBundled) return inflightBundled;

    const promise = (async (): Promise<{ version: string; handles: string[] } | null> => {
      const snap = await getBundledSnapshot();
      if (!snap) return null;
      const parsed = parseStoredSnapshot(snap.body);
      if (!parsed.ok) return null;
      const next = {
        version: parsed.value.snapshot_version,
        handles: parsed.value.entries.map((entry) => entry.handle),
      };
      bundledHandlesCache = next;
      return next;
    })().finally(() => {
      if (inflightBundled === promise) {
        inflightBundled = null;
      }
    });

    inflightBundled = promise;
    return promise;
  }

  async function getRuntimeResponse(): Promise<CommunityRuntimeResponse> {
    const [settings, bundled] = await Promise.all([getCommunitySettings(), loadBundledHandles()]);
    const state = settings.enabled ? await loadCommunityState() : null;

    if (!settings.enabled || !state) {
      return {
        enabled: settings.enabled,
        strength: settings.strength,
        autoContribute: settings.autoContribute,
        community: null,
        builtinHandles: bundled?.handles ?? [],
      };
    }

    const deepClean = settings.strength === 'deep_clean';
    const sameAsBundled = !!bundled && state.snapshotVersion === bundled.version;

    return {
      enabled: settings.enabled,
      strength: settings.strength,
      autoContribute: settings.autoContribute,
      community: {
        version: state.snapshotVersion,
        handles: state.handles,
        verified: state.verified,
        whitelist: state.whitelist,
        mutedRules: state.mutedRules,
        fingerprints: deepClean ? state.fingerprints : [],
        domains: deepClean ? state.domains : [],
        ...(state.killSwitch ? { killSwitch: state.killSwitch } : {}),
      },
      builtinHandles: sameAsBundled ? [] : (bundled?.handles ?? []),
      ...(sameAsBundled ? { builtinSameAsCommunity: true } : {}),
    };
  }

  async function lookup(params: {
    handles?: unknown;
    fingerprints?: unknown;
  }): Promise<CommunityLookupResponse> {
    const state = await loadCommunityState();
    if (!state) {
      return { version: '', entries: {}, campaigns: {} };
    }

    const entries: Record<string, CommunityEntry | null> = {};
    if (Array.isArray(params.handles)) {
      for (const raw of params.handles) {
        if (typeof raw !== 'string') continue;
        const normalized = normalizeHandle(raw);
        if (!normalized || normalized in entries) continue;
        entries[normalized] = state.index.lookup(normalized);
      }
    }

    const campaigns: Record<string, CommunityEntry | null> = {};
    if (Array.isArray(params.fingerprints)) {
      for (const raw of params.fingerprints) {
        if (typeof raw !== 'string' || !raw || raw in campaigns) continue;
        const campaignHandle = state.campaignByFingerprint.get(raw);
        campaigns[raw] = campaignHandle ? (state.campaignById.get(campaignHandle) ?? null) : null;
      }
    }

    return {
      version: state.snapshotVersion,
      entries,
      campaigns,
    };
  }

  function handleMessage(message: unknown): Promise<unknown> | undefined {
    const msg = message as {
      type?: unknown;
      handles?: unknown;
      fingerprints?: unknown;
    } | null;
    if (!msg || typeof msg.type !== 'string') return undefined;
    if (msg.type === COMMUNITY_RUNTIME_MESSAGE) {
      return getRuntimeResponse();
    }
    if (msg.type === COMMUNITY_LOOKUP_MESSAGE) {
      return lookup({ handles: msg.handles, fingerprints: msg.fingerprints });
    }
    return undefined;
  }

  const onStorageChanged = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName === 'local' && changes[SNAPSHOT_KEY]) {
      invalidate();
    }
  };

  function register(): void {
    browser.storage.onChanged.addListener(onStorageChanged);
  }

  function dispose(): void {
    browser.storage.onChanged.removeListener(onStorageChanged);
  }

  return {
    register,
    dispose,
    invalidate,
    getRuntimeResponse,
    lookup,
    handleMessage,
  };
}
