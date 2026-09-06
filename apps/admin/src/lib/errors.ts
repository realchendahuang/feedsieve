const labels: Record<string, string> = {
  invalid_pack: '分类内容不完整',
  invalid_rule: '规则内容不完整',
  invalid_note: '备注至少需要四个字',
  invalid_handle: '账号格式不正确',
  access_required: 'Access 身份未授权',
  http_401: 'Access 身份未授权',
  http_403: '当前账号没有管理权限',
  http_429: '请求过于频繁，请稍后再试',
  http_500: '服务器暂时不可用，请稍后再试',
  invalid_response: '管理端暂时不可用，请刷新后重试',
  publish_failed: '发布失败',
  release_not_found: '发布记录不存在',
  release_archive_missing: '发布归档不存在',
  release_archive_invalid: '发布归档不可用',
  release_archive_unavailable: '发布存储不可用',
  keyword_packs_unavailable: '公开词库不可用',
  no_active_packs: '没有启用的分类',
  invalid_version: '版本号无效',
};

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : '操作失败';
  return labels[message] ?? message;
}
