/**
 * Host 门控判定（官网公开页 / 管理 SPA / API 三个域名共用的守卫数据源）。
 *
 * 默认值返回 false —— 未配置对应主机名时，对应域名一律不生效。
 * 值支持 CSV 多域名：域名迁移期把保底旧域与统一后的新域并列，旧客户端不断链。
 */
export function isConfiguredHost(
  request: Request,
  env: Cloudflare.Env,
  variable: 'ADMIN_HOST' | 'SITE_HOST',
): boolean {
  const configured = env[variable]?.trim().toLowerCase();
  if (!configured) return false;
  const hostname = new URL(request.url).hostname.toLowerCase();
  return configured.split(',').some((host) => host.trim() && host.trim() === hostname);
}

export function isAdminHost(request: Request, env: Cloudflare.Env): boolean {
  return isConfiguredHost(request, env, 'ADMIN_HOST');
}

/** 官网公开页域名（首页 / 名单公示 / 教程）。 */
export function isSiteHost(request: Request, env: Cloudflare.Env): boolean {
  return isConfiguredHost(request, env, 'SITE_HOST');
}
