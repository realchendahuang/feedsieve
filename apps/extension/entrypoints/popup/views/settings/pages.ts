/**
 * 弹窗设置页的页面 id。
 *
 * 分成三组：
 * - 校秤：模块开关 / 数据与隐私 / 关于
 * - 模块齿轮页：每个模块自己的设置（在模块 tab 内打开）
 * - 过滤子页：界面净化、过滤规则、名单
 */
import type { ModuleSettingsPage } from '../../../../src/lib/settings/modules';

export type GlobalPage = 'global' | 'data' | 'about';

export type FilterSubpage =
  | 'filterRules'
  | 'cleanUi'
  | 'keywords'
  | 'blocked'
  | 'allowlist'
  | 'following';

export type SettingsPage = GlobalPage | ModuleSettingsPage | FilterSubpage;

export function isGlobalPage(page: SettingsPage): page is GlobalPage {
  return page === 'global' || page === 'data' || page === 'about';
}
