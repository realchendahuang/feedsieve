/**
 * 标注时刻的内容证据收集（上报载荷，见 contribute.ts）。
 *
 * 从 detection-pipeline 拆出：指纹与外链域名收集是隐私敏感动作，
 * 独立成模块便于单独审计「证据只采集什么、何时只装进载荷」。
 */

import { contentFingerprintV1, type DetectInput } from '@feedsieve/detector';

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

export interface BlockEvidence {
  contentFingerprint?: string;
  linkDomains?: string[];
  /** 判断来源；手动标记路径强制 manual，检测器命中带各自来源。 */
  detectionSource?: string;
}

/** 内容证据只用于用户主动标记或高置信命中后的社区证据，识别主流程不消费这些值。 */
export function collectContentEvidence(source: DetectInput): BlockEvidence {
  // v0.8 起产 v1 指纹（NFKC + 停用字 + 更低门槛）：新拉黑账号随上报
  // 自然积累 v1 模板；本地旧记录的 v0 指纹值继续原样上报，两者在服务端并存。
  const evidence: BlockEvidence = {};
  const fp = contentFingerprintV1(source);
  if (fp) evidence.contentFingerprint = fp;
  const linkDomains = collectLinkDomains(source.links ?? []);
  if (linkDomains) evidence.linkDomains = linkDomains;
  return evidence;
}
