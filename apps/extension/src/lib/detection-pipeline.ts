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
  contentFingerprintV1,
  detect,
  type DetectInput,
  type Detection,
  type HeuristicRule,
  weakSignalCombo,
} from '@feedsieve/detector';
import type { CommunityEntry, MarkStrength } from '@feedsieve/community-lists';
import type { RuntimeCommunity } from './community-store';
import { classifyDetection, type DetectionPresentation } from './detection-policy';
import { categoryLabel, localizedDetectionReason, type UiLanguage } from './i18n';
import { categoryFromDetection, collectLinkDomains } from './contribute';
import type { KeywordPackCatalog } from './keyword-packs';

/** 标注时刻收集的内容证据（上报载荷，见 contribute.ts）。 */
export interface BlockEvidence {
  contentFingerprint?: string;
  linkDomains?: string[];
  /** 判断来源；手动标记路径强制 manual，检测器命中带各自来源。 */
  detectionSource?: string;
}

export interface DetectionPipelineInput {
  input: DetectInput;
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
 * 社区名单命中的黄框理由：票数为主体，证据/分类为注脚。
 * 发布分类可能来自证据推导而非逐张票面，措辞不宣称「N 人标记为 X」；
 * 分类为 other（无证据、无具体票）时只报票数，不冒充具体理由。
 */
export function communityHitReason(
  entry: Pick<CommunityEntry, 'category' | 'report_count' | 'domains' | 'campaign_size'>,
  uiLanguage: UiLanguage,
): string {
  const voteSummary =
    entry.report_count > 1
      ? uiLanguage === 'zh'
        ? `${entry.report_count} 人标记`
        : `${entry.report_count} community marks`
      : uiLanguage === 'zh'
        ? '社区名单'
        : 'Community list';
  const detail =
    (entry.domains?.length ?? 0) > 0
      ? uiLanguage === 'zh'
        ? '外链指向垃圾域名'
        : 'links to spam domains'
      : (entry.campaign_size ?? 0) >= 2
        ? uiLanguage === 'zh'
          ? `与 ${entry.campaign_size} 个已确认垃圾账号同模板`
          : `matches template of ${entry.campaign_size} confirmed spam accounts`
        : entry.category !== 'other'
          ? categoryLabel(entry.category, uiLanguage)
          : '';
  return detail ? `${voteSummary} · ${detail}` : voteSummary;
}

export function runDetectionPipeline(input: DetectionPipelineInput): DetectionPipelineResult {
  const { input: source, community, builtinList, keywordHeuristics, catalog, strength, uiLanguage } =
    input;

  // 公开白名单（whitelist）与社区白名单（verified）一票豁免：被验证为「误标正常」
  // 的账号在任何识别（社区名单 / 指纹 / 域名 / 词包）之前直接放行。与黑名单数学互斥，
  // 此先查是防御性兜底——即便服务端异常双发，也以「验证正常」为准。
  const verifiedHandle = source.handle.trim().replace(/^@+/, '').toLowerCase();
  if (
    community?.whitelistSet.has(verifiedHandle) ||
    community?.verifiedSet.has(verifiedHandle)
  ) {
    return {
      detection: null,
      evidence: {},
      communityEntry: null,
      communityCategory: undefined,
      category: undefined,
      presentation: 'ignore',
    };
  }

  // 内容证据只用于用户主动标记或高置信命中后的社区证据。
  // v0.8 起产 v1 指纹（NFKC + 停用字 + 更低门槛）：新拉黑账号随上报
  // 自然积累 v1 模板；本地旧记录的 v0 指纹值继续原样上报，两者在服务端并存。
  const evidence: BlockEvidence = {};
  const fp = contentFingerprintV1(source);
  if (fp) evidence.contentFingerprint = fp;
  const linkDomains = collectLinkDomains(source.links ?? []);
  if (linkDomains) evidence.linkDomains = linkDomains;

  // 识别顺序：社区快照名单 -> 内置名单兜底 -> 用户/官方可配置词库。
  const evidenceOptions = {
    ...(community?.fingerprintSet.size ? { fingerprints: community.fingerprintSet } : {}),
    ...(community?.domainSet.size ? { domains: community.domainSet } : {}),
  };
  let detection = community
    ? detect(source, {
        list: community.handleSet,
        listSource: 'community-list',
        // v0.5 指纹即 SimHash：simhashes 集合与 fingerprints 集合同源，
        // exact 命中优先，miss 后走汉明距离找「话术变体」
        ...(community.fingerprintSet.size ? { simhashes: community.fingerprintSet } : {}),
        ...evidenceOptions,
        // 关键词/默认名称等单信号只保留在 Detector 评测层，不直接进入黄框
        heuristics: [],
      })
    : null;
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
      // 用户明确配置的字面短语 / 官方词库，加上弱信号组合层——唯一升到页面的
      // 内置启发式（乱码批量号锚点 + 内容佐证，分层见 detection-policy；
      // 其余内置单信号规则仍只留在 detector 评测层）。排在词库规则之后收尾。
      heuristics: [...keywordHeuristics, weakSignalCombo],
    });
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
    evidence,
    communityEntry,
    communityCategory,
    category,
    presentation,
  };
}