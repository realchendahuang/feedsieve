/**
 * 公示申请词汇 —— 跨应用唯一权威源（官网申请接口、community-api 校验、admin 队列页共用）。
 *
 * 申请两类：
 * - whitelist：博主自荐进推荐白名单（公示页的博主宣言，入册需邮箱验证 + 维护者裁决）。
 * - appeal：被公示账号申诉误伤（主张公示条目有误，走同一队列复核）。
 *
 * 状态机：pending（已提交，邮箱未验证）→ verified（邮箱已验证，进维护者队列）
 * → approved / rejected（维护者裁决，终态）。
 */
export const APPLICATION_KINDS = ['whitelist', 'appeal'] as const;

export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

export function isApplicationKind(value: string): value is ApplicationKind {
  return (APPLICATION_KINDS as readonly string[]).includes(value);
}

export const APPLICATION_STATUSES = ['pending', 'verified', 'approved', 'rejected'] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** 未决状态（pending / verified）：同账号同类型已有未决申请时不再接受重复提交 */
export function isOpenApplicationStatus(status: string): boolean {
  return status === 'pending' || status === 'verified';
}
