/**
 * content script 的注入样式（ISOLATED world 无法共享样式文件，只能在这里注入）。
 * 调整主题时需要与 popup.css 同步检查基础色。
 */

import { HIDDEN_TWEET_CELL_ATTRIBUTE } from '../platform/remove-tweets';
import { MARK_ATTRIBUTE } from './page-state';
import { ACTION_SLOT_CSS } from './action-slot';

const STYLE_ELEMENT_ID = 'feedsieve-mark-styles';

export function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  // 颜色与 popup.css 同一套规则（docs/04 第 5 节）；isolated world 无法共享样式文件，两处需要同步检查。
  style.textContent = `
    /* 标黄：配色规则里黄色 = 需要你处理（见 docs/04 第 5 节）。
       不再整圈描边（像警戒围栏），改成左侧一条黄线 + 极浅的黄底，和 X 的时间线融在一起；
       box-shadow 不占布局空间，不挤压格子内容。 */
    [${MARK_ATTRIBUTE}] {
      box-shadow: inset 3px 0 0 #f59e0b;
      background-color: rgba(245, 158, 11, 0.06);
    }
    /* 嵌套命中（引用帖/媒体也自成 cellInnerDiv）只保留最外层的标记 */
    [${MARK_ATTRIBUTE}] [${MARK_ATTRIBUTE}] {
      box-shadow: none;
      background-color: transparent;
    }
    /* X 的 cell 仍由其 React/虚拟列表持有；只折叠显示，绝不从 DOM 物理删除。 */
    [${HIDDEN_TWEET_CELL_ATTRIBUTE}] {
      display: none !important;
    }
    /* 标黄推文下方的一行：[盾牌] 理由 ……… [拉黑] 误标？ 抢救 公示
       左边和推文正文对齐（16px 内边距 + 40px 头像 + 8px 间距），
       字体、字号跟 X 一致；理由用 X 的次要文字色，只有盾牌和「拉黑」是黄色。 */
    .fs-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: -2px 16px 0 64px;
      padding: 0 0 12px;
      color: rgb(113, 118, 123);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.4;
    }
    .fs-badge > svg { flex: none; color: #f59e0b; }
    .fs-reason {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .fs-actions { flex: none; display: flex; align-items: center; gap: 2px; margin-left: auto; white-space: nowrap; }
    .fs-actions-soft { margin-left: 0; }
    .fs-block-now,
    .fs-allow {
      height: 28px;
      padding: 0 12px;
      border-radius: 999px;
      font: inherit;
      font-size: 13px;
      white-space: nowrap;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .fs-block-now {
      border: 1px solid rgba(245, 158, 11, 0.6);
      background: transparent;
      color: #d97706;
      font-weight: 700;
    }
    .fs-block-now:hover:not(:disabled) { background: rgba(245, 158, 11, 0.14); }
    .fs-block-now:disabled { opacity: 0.6; cursor: wait; }
    .fs-allow {
      padding: 0 8px;
      border: 0;
      background: transparent;
      color: rgb(113, 118, 123);
    }
    .fs-allow:hover { background: rgba(113, 118, 123, 0.12); }
    ${ACTION_SLOT_CSS}
    @keyframes fs-pulse { 50% { opacity: 0.35; } }
    /* 配色只分三路（见 docs/04 第 5 节）：
       - 灰：身份与元数据（量级）。继承 X 那一行的次要文字色，亮暗主题自动跟随。
       - 绿 → 红：热度（流速），页面上唯一的彩色刻度。越热越醒目：平稳只是绿字，
         火了加浅红底，爆了实心红底。只有流速会出现底色。
       - 黄：需要处理（标黄的垃圾账号、拉黑按钮的悬停）。
       流速：时间线和详情页都在推文右上角。数字用等宽数字，刷新时不跳。 */
    .fs-velocity {
      align-self: center;
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 22px;
      margin-right: 6px;
      padding: 0 2px;
      border-radius: 999px;
      color: #00a36c;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: default;
      user-select: none;
      transition: background-color 160ms ease, color 160ms ease;
    }
    .fs-velocity svg { flex: none; }
    .fs-velocity[data-fs-level='hot'] {
      padding: 0 8px 0 6px;
      background: rgba(244, 33, 46, 0.1);
      color: #f4212e;
    }
    .fs-velocity[data-fs-level='rocket'] {
      padding: 0 8px 0 6px;
      background: #f4212e;
      color: #fff;
    }
    .fs-velocity[data-fs-level='rocket'] svg { animation: fs-flicker 1.6s ease-in-out infinite; }
    @keyframes fs-flicker {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
    @media (prefers-reduced-motion: reduce) {
      .fs-velocity[data-fs-level='rocket'] svg { animation: none; }
    }
    /* 底部动作栏兜底位置：不要胶囊外边距 */
    .fs-velocity[data-fs-place='bar'] { margin: 0 0 0 4px; }
    /* 主页倍数：灰色数字；≥3× 金色胶囊（爆款） */
    .fs-multiple {
      align-self: center;
      flex: none;
      display: inline-flex;
      align-items: center;
      height: 22px;
      margin-right: 6px;
      padding: 0 2px;
      border-radius: 999px;
      color: rgb(83, 100, 113);
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: default;
      user-select: none;
    }
    .fs-multiple[data-fs-level='outlier'] {
      padding: 0 8px;
      background: rgba(255, 173, 31, 0.16);
      color: #b26b00;
    }
    .fs-multiple[data-fs-place='bar'] { margin: 0 0 0 4px; }
    /* 主页资料卡下的洞察行 */
    .fs-profile-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 6px;
      margin: 8px 0 0;
      padding: 0;
      border: 0;
      background: none;
      color: rgb(83, 100, 113);
      font: inherit;
      font-size: 14px;
      line-height: 20px;
      text-align: left;
      cursor: pointer;
    }
    .fs-profile-line:hover .fs-profile-key { text-decoration: underline; }
    .fs-profile-line .fs-profile-key { color: rgb(15, 20, 25); font-weight: 700; }
    .fs-profile-line > span + span::before { content: '·'; margin-right: 6px; color: rgb(83, 100, 113); }
    /* 窄推文（< 470px）：右上角只给正在火的帖子留位置，而且只留数字；
       平稳的绿色流速让位给作者名。详情页那一行空间够，不受影响。 */
    article[data-fs-size='narrow'] .fs-velocity[data-fs-place='top'][data-fs-level='none'] { display: none; }
    article[data-fs-size='narrow'] .fs-velocity[data-fs-place='top'] { padding: 0 7px; margin-right: 4px; gap: 0; }
    article[data-fs-size='narrow'] .fs-velocity[data-fs-place='top'] svg { display: none; }
    /* 热帖定位：从弹窗点击后短暂高亮所在格子 */
    [data-fs-flash] {
      animation: fs-flash 1.6s ease-out;
    }
    @keyframes fs-flash {
      0%, 30% { box-shadow: inset 0 0 0 2px rgba(245, 158, 11, 0.9); background-color: rgba(254, 243, 199, 0.45); }
      100% { box-shadow: inset 0 0 0 2px rgba(245, 158, 11, 0); background-color: transparent; }
    }
    /* 复制结果的瞬时提示，2 秒后自动移除 */
    .fs-toast {
      position: fixed;
      left: 50%;
      bottom: 32px;
      transform: translateX(-50%);
      z-index: 2147483647;
      padding: 8px 16px;
      border-radius: 999px;
      background: rgba(15, 20, 25, 0.92);
      color: #fff;
      font-size: 14px;
      pointer-events: none;
    }
    /* 量级：@handle 那一行末尾，按 X 自己的元数据写法接一个「·」：
       「@handle · 8小时 · ☆ 12.8K」。不加底色、不分颜色，六档只靠图标区分
       （嫩芽 → 皇冠）。颜色由脚本从这一行的行内样式里取 X 的次要文字色，
       取不到时用下面的默认灰（亮暗主题都可读）。档位名只在悬停卡片里。 */
    .fs-tier {
      align-self: center;
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: rgb(113, 118, 123);
      font-size: inherit;
      line-height: inherit;
      white-space: nowrap;
      cursor: default;
      user-select: none;
    }
    .fs-tier::before {
      content: '·';
      padding: 0 4px;
    }
    .fs-tier svg { flex: none; }
    .fs-tier-count { font-variant-numeric: tabular-nums; }
    /* 窄推文：只留档位图标，粉丝数在悬停卡片里 */
    article[data-fs-size='narrow'] .fs-tier-count { display: none; }
    /* 悬停卡片：深色浮层，亮暗主题通用；跟 X 原生提示一样不拦截鼠标 */
    .fs-hovercard {
      position: fixed;
      z-index: 2147483646;
      display: none;
      min-width: 200px;
      max-width: 300px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(15, 20, 25, 0.96);
      color: #e7e9ea;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
      pointer-events: none;
    }
    .fs-hovercard[data-open] { display: block; }
    .fs-hc-title { font-weight: 700; color: #fff; margin-bottom: 6px; }
    .fs-hc-rows {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 14px;
    }
    .fs-hc-label { color: #8b98a5; white-space: nowrap; }
    .fs-hc-value { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .fs-hc-note { margin-top: 7px; color: #ffd400; font-size: 12px; }
    .fs-hc-foot {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: #71767b;
      font-size: 11px;
    }
  `;
  document.documentElement.appendChild(style);
}
