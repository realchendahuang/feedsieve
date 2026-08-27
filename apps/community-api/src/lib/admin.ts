export const ADMIN_STATUSES = ['recommended', 'strong', 'dismissed'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

// 人工决策只能给出这三种终态；candidate 由自动化产生，new 表示票数不足
export function isAdminStatus(value: unknown): value is AdminStatus {
  return (
    typeof value === 'string' &&
    (ADMIN_STATUSES as readonly string[]).includes(value)
  );
}
