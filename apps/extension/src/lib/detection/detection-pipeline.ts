/**
 * 页面检测管线：输入 → 可解释标注所需的全部信息。
 *
 * 顺序与 content.ts 原 scanOne 完全一致：
 * 社区名单 → 内置名单兜底 → 用户/官方可配置词库；命中后依次做
 * 社区条目增强（票数/分类）、话术变体（Campaign）增强、本地化理由、
 * classifyDetection 分层（block-candidate / review / ignore）与分类推导。
 *
 * 抽取目的：让「检测与分层」成为可独立单测的单元，并支撑 golden corpus 的
 * 分层指标（review 层 vs 批拉层），而不是只测 detector 底层规则。
 */

import {
  detect,
  RUNTIME_HEURISTICS,
  type DetectInput,
  type Detection,
  type HeuristicRule,
} from '@feedsieve/detector';
import type { CommunityEntry, MarkStrength } from '@feedsieve/community-lists';
import type { RuntimeCommunity } from '../community/community-store';
import { classifyDetection, type DetectionPresentation } from './detection-policy';
import { categoryLabel, localizedDetectionReason, type UiLanguage } from '../platform/i18n';
import { categoryFromDetection } from '../community/contribute';
import { collectContentEvidence, type BlockEvidence } from './detection-evidence';
import type { KeywordPackCatalog } from './keyword-packs';

export type { BlockEvidence };

export interface DetectionPipelineInput {
  input: DetectInput & { postId?: string };
  community: RuntimeCommunity | null;
  builtinList: ReadonlySet<string>;
  keywordHeuristics: readonly HeuristicRule[];
  /** 远程词库（行业包分类推导用；keywordCatalog.packs 可按 pack 反查规则归属） */
  catalog: KeywordPackCatalog;
  strength: MarkStrength;
  uiLanguage: UiLanguage;
}

export interface DetectionPipelineResult {
  /** 未命中 / 分层为 ignore 时为 null */
  detection: Detection | null;
  evidence: BlockEvidence;
  communityEntry: CommunityEntry | null;
  communityCategory: string | undefined;
  /** 最终标注分类（词库行业包优先，其次按来源/规则推导） */
  category: string | undefined;
  presentation: DetectionPresentation;
}

/** 远程词库可新增行业包；页面本地统计仍保留该包的真实分类，不降级成 other。 */
function keywordCategoryFromCatalog(
  catalog: KeywordPackCatalog,
  ruleId: string | null | undefined,
): string | undefined {
  if (!ruleId?.startsWith('keyword:official:')) return undefined;
  const officialId = ruleId.slice('keyword:official:'.length);
  return catalog.packs.find((pack) => pack.rules.some((rule) => rule.id === officialId))?.id;
}

/**
 * 社区名单命中的黄框理由：票数为主体，证据/分类/争议为注脚。
 * 发布分类可能来自证据推导而非逐张票面，措辞不宣称「N 人标记为 X」。
 *
 * 票数不等于共识：有抢救票时同时报出来，否则「5 人标记」看起来像 5 人一致认定。
 * 分类 other 且没有任何证据时写明「原因未细分」——旧客户端手动票不带原因，
 * 与其让别人猜，不如承认这条标注没有可解释的细分理由。
 * 维护者写过 reason 的条目优先展示维护者说明（维护者单源时票数位也换成「维护者标注」）。
 */
export function communityHitReason(
  entry: Pick<
    CommunityEntry,
    | 'category'
    | 'report_count'
    | 'rescue_count'
    | 'sources'
    | 'maintainer_note'
    | 'domains'
    | 'campaign_size'
  >,
  uiLanguage: UiLanguage,
): string {
  const zh = uiLanguage === 'zh';
  const maintainer = entry.sources.includes('maintainer');
  const note = maintainer ? (entry.maintainer_note?.trim() ?? '') : '';
  const voteSummary =
    maintainer && entry.report_count <= 0
      ? zh
        ? '维护者标注'
        : 'Maintainer listed'
      : entry.report_count > 1
        ? zh
          ? `${entry.report_count} 人标记`
          : `${entry.report_count} community marks`
        : zh
          ? '社区名单'
          : 'Community list';
  const rescueSummary =
    entry.rescue_count > 0
      ? zh
        ? `${entry.rescue_count} 人抢救`
        : `${entry.rescue_count} rescues`
      : '';
  const detail = note
    ? entry.report_count > 0
      ? zh
        ? `维护者：${note}`
        : `Maintainer: ${note}`
      : note
    : (entry.domains?.length ?? 0) > 0
      ? zh
        ? '外链指向垃圾域名'
        : 'links to spam domains'
      : (entry.campaign_size ?? 0) >= 2
        ? zh
          ? `与 ${entry.campaign_size} 个已确认垃圾账号同模板`
          : `matches template of ${entry.campaign_size} confirmed spam accounts`
        : entry.category !== 'other'
          ? categoryLabel(entry.category, uiLanguage)
          : zh
            ? '原因未细分'
            : 'reason not specified';
  return [voteSummary, rescueSummary, detail].filter(Boolean).join(' · ');
}

export function runDetectionPipeline(input: DetectionPipelineInput): DetectionPipelineResult {
  const {
    input: source,
    community,
    builtinList,
    keywordHeuristics,
    catalog,
    strength,
    uiLanguage,
  } = input;

  // 先保留当前页面材料：即使社区白名单使检测豁免，用户仍可显式覆盖并手动拉黑。
  const evidence = collectContentEvidence(source);

  // 推荐白名单（whitelist）与社区白名单（verified）一票豁免：被验证为「误标正常」
  // 的账号在任何识别（社区名单 / 指纹 / 域名 / 词包）之前直接放行。与黑名单数学互斥，
  // 此先查是防御性兜底——即便服务端异常双发，也以「验证正常」为准。
  const verifiedHandle = source.handle.trim().replace(/^@+/, '').toLowerCase();
  if (community?.whitelistSet.has(verifiedHandle) || community?.verifiedSet.has(verifiedHandle)) {
    return {
      detection: null,
      evidence,
      communityEntry: null,
      communityCategory: undefined,
      category: undefined,
      presentation: 'ignore',
    };
  }

  // 误伤率超线、已被服务端静音的规则（快照 muted_rules）：不再用它们标黄框。名单命中不受影响。
  const muted = community?.mutedRules;
  const isMuted = (found: Detection | null): boolean =>
    !!found?.ruleId &&
    !!muted?.has(found.ruleId) &&
    found.source !== 'community-list' &&
    found.source !== 'builtin-list';
  // 精确指纹和话术变体分开静音：只静音其一时，另一种照常用
  const exactMuted = !!muted?.has('community-fingerprint');
  const variantMuted = !!muted?.has('community-fingerprint-sim');
  const domainsMuted = !!muted?.has('community-domain');

  // 识别顺序：社区快照名单 -> 内置名单兜底 -> 用户/官方可配置词库。
  const evidenceOptions = {
    ...(community?.fingerprintSet.size && !exactMuted
      ? { fingerprints: community.fingerprintSet }
      : {}),
    ...(community?.domainSet.size && !domainsMuted ? { domains: community.domainSet } : {}),
  };
  let detection = community
    ? detect(source, {
        list: community.handleSet,
        listSource: 'community-list',
        // v0.5 指纹即 SimHash：simhashes 集合与 fingerprints 集合同源，
        // exact 命中优先，miss 后走汉明距离找「话术变体」
        ...(community.fingerprintSet.size && !variantMuted
          ? { simhashes: community.fingerprintSet }
          : {}),
        ...evidenceOptions,
        // 关键词/默认名称等单信号只保留在 Detector 评测层，不直接进入黄框
        heuristics: [],
      })
    : null;
  // 兜底：命中的是被静音的规则就当没命中，继续往下查
  if (isMuted(detection)) detection = null;
  if (!detection && builtinList.size > 0) {
    detection = detect(source, {
      list: builtinList,
      listSource: 'builtin-list',
      ...evidenceOptions,
      heuristics: [],
    });
  }
  if (!detection) {
    detection = detect(source, {
      ...evidenceOptions,
      // 用户明确配置的字面短语 / 官方词库，加上内置组合层与双信号启发式（RUNTIME_HEURISTICS）——
      // weak-signal-combo（乱码/数字批量号锚点 + 内容佐证）、fresh-account-combo（新注册小号 +
      // 内容佐证）与 contact-number-bait（正文长数字载荷 + 简介钩子），分层见 detection-policy；
      // 其余内置单信号规则仍只留在 detector 评测层。排在词库规则之后收尾。
      heuristics: [...keywordHeuristics, ...RUNTIME_HEURISTICS].filter(
        (rule) => !muted?.has(rule.id),
      ),
    });
    if (isMuted(detection)) detection = null;
  }

  if (!detection) {
    return {
      detection: null,
      evidence,
      communityEntry: null,
      communityCategory: undefined,
      category: undefined,
      presentation: 'ignore',
    };
  }

  // 社区名单命中：徽章带可解释理由（票数 + 证据/分类注脚，绝不说「标记为其他」）
  let communityEntry: CommunityEntry | null = null;
  let communityCategory: string | undefined;
  if (detection.source === 'community-list' && community) {
    const entry = community.index.lookup(source.handle);
    if (entry) {
      communityEntry = entry;
      communityCategory = entry.category;
      detection = {
        ...detection,
        reason: communityHitReason(entry, uiLanguage),
      };
    }
  }

  // v0.5 Campaign：指纹命中（exact 或变体）时反查簇规模，徽章显示「同模板 N 个账号」
  if (detection.source === 'fingerprint' && community) {
    const campaignHandle = detection.matchedFingerprint
      ? community.campaignByFingerprint.get(detection.matchedFingerprint)
      : undefined;
    const campaign = campaignHandle ? community.campaignById.get(campaignHandle) : undefined;
    if (campaign) {
      detection = {
        ...detection,
        campaignEntryId: campaign.campaign_entry_id,
        reason:
          uiLanguage === 'zh'
            ? `与 ${campaign.campaign_size} 个已确认垃圾账号发布的内容高度相似`
            : `Highly similar to content from ${campaign.campaign_size} confirmed spam accounts`,
      };
    }
  }

  if (detection.source !== 'community-list') {
    detection = {
      ...detection,
      reason: localizedDetectionReason(uiLanguage, detection),
    };
  }

  const presentation = classifyDetection({ detection, strength, communityEntry });
  const category =
    keywordCategoryFromCatalog(catalog, detection.ruleId) ??
    categoryFromDetection(detection.source, detection.ruleId, communityCategory);

  return {
    detection: presentation === 'ignore' ? null : detection,
    evidence: {
      ...evidence,
      detectionSource: detection.source,
      ...(detection.ruleId ? { ruleId: detection.ruleId, signalIds: [detection.ruleId] } : {}),
    },
    communityEntry,
    communityCategory,
    category,
    presentation,
  };
}
