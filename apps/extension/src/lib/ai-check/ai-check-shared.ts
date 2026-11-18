import type { Lang } from '@feedsieve/shared';
import type { AiRhythm } from './client';
import type { ApiTweet } from './evidence';

export const SITE_BASE = 'https://feedsieve.win';
export const MARK_ATTR = 'data-fs-ai-mark';
export const TONE_ATTR = 'data-fs-ai-tone';
export const FOLD_ATTR = 'data-fs-ai-fold';
export const AUTOSTART_KEY = 'fs-ai-autostart';
export const BUTTON_ATTR = 'data-fs-ai';
export const TAB_ATTR = 'data-fs-ai-tab';
export const PANEL_ID = 'fs-ai-panel';
export const STYLE_ID = 'feedsieve-ai-check-styles';

export const TONE_COLOR = { ai: '#ff4d6d', mixed: '#ffb020', human: '#22d39b' } as const;

/** 一个账号的结论：服务端可公开的，或者自己测过、还没公开的（只有本人能看到） */
export interface Known {
  verdict: 'ai' | 'suspect' | 'human' | 'insufficient' | null;
  score: number | null;
  replyCount: number;
  rhythm: AiRhythm | null;
  expired: boolean;
  votes: { ai_count: number; human_count: number; listed: boolean } | null;
  myVote: 'ai' | 'human' | null;
  /** 来自自己的本机记录、服务端还没公开 */
  mineOnly: boolean;
  underReview: boolean;
  /** 判定模型给的一句话锐评（服务端判的或自己测出来的） */
  comment: string | null;
}

export type Judged = Known & { score: number; verdict: 'ai' | 'suspect' | 'human' };

export function judged(k: Known | null | undefined): k is Judged {
  return !!k && k.score !== null && !!k.verdict && k.verdict !== 'insufficient';
}

export interface AiCheckDeps {
  getLanguage: () => Lang;
  getSelfHandle: () => string | null;
  /** 已关注、个人白名单：不标记、不折叠（已关注可在设置里单独放开） */
  isProtected?: (handle: string) => boolean;
  /** 个人白名单：永远不自动标记 */
  isAllowlisted?: (handle: string) => boolean;
  /** 用户自己关注的人：默认不自动标记，markFollowing 打开后照常标 */
  isFollowing?: (handle: string) => boolean;
  /** 模块总开关：关掉后页面上的标签、折叠、检测按钮和主页 Tab 全部撤掉 */
  isEnabled?: () => boolean;
  send: (message: unknown) => Promise<unknown>;
}

export interface AiCheckRunnerHost {
  getLanguage: () => Lang;
  send: (message: unknown) => Promise<unknown>;
  isStopped: () => boolean;
  getApiTweets: () => readonly ApiTweet[];
  lookup: (handle: string) => Promise<Known | null>;
  getKnown: (handle: string) => Known | null | undefined;
  setKnown: (handle: string, entry: Known) => void;
  repliesTab: (handle: string) => HTMLAnchorElement | null;
  ensureTab: () => void;
  openInNewTab: (handle: string, force: boolean, postId?: string) => void;
}

export interface AiCheckRunner {
  openFromTab(handle: string, force?: boolean): void;
  showKnown(handle: string, known: Judged, postId?: string): void;
  startFromPanel(handle: string, force: boolean): void;
  run(handle: string, force?: boolean, postId?: string): Promise<void>;
  onApiTweets(tweets: readonly ApiTweet[]): void;
  tick(profile: { handle: string; tab: string } | null): void;
  hasPendingFor(handle: string): boolean;
  closePanel(): void;
  stop(): void;
}

export type AiCheckRunnerFactory = (host: AiCheckRunnerHost) => AiCheckRunner;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function ensureAiCheckStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${TAB_ATTR}] .fs-ai-tab-pct { margin-left: 4px; font-weight: 800; }
    #${PANEL_ID} {
      position: fixed; top: 72px; right: 24px; z-index: 2147483000; width: 320px; box-sizing: border-box;
      padding: 18px; border-radius: 20px; background: #0b0d12; color: #fff;
      border: 1px solid rgba(255,255,255,.12); box-shadow: 0 20px 60px rgba(0,0,0,.45);
      font: 14px/1.45 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      animation: fs-ai-in .28s cubic-bezier(.2,.9,.3,1.2);
    }
    #${PANEL_ID} * { box-sizing: border-box; }
    @keyframes fs-ai-in { from { opacity: 0; transform: translateY(-8px) scale(.97); } }
    .fs-ai-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .fs-ai-title { font-weight: 800; font-size: 15px; }
    .fs-ai-handle { color: rgba(255,255,255,.55); font-size: 13px; margin-left: 6px; font-weight: 500; }
    .fs-ai-x { border: 0; background: transparent; color: rgba(255,255,255,.5); font-size: 18px; cursor: pointer; line-height: 1; }
    .fs-ai-x:hover { color: #fff; }
    .fs-ai-primary, .fs-ai-ghost {
      display: flex; align-items: center; justify-content: center; text-align: center;
      width: 100%; height: 40px; padding: 0 12px; border-radius: 9999px;
      font: 800 14px/1 inherit; font-family: inherit; cursor: pointer;
    }
    .fs-ai-primary:disabled, .fs-ai-ghost:disabled { opacity: .6; cursor: default; }
    .fs-ai-primary { border: 0; background: #fff; color: #0b0d12; }
    .fs-ai-primary:hover { background: #e7e9ea; }
    .fs-ai-ghost { border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff; }
    .fs-ai-ghost:hover { background: rgba(255,255,255,.08); }
    .fs-ai-row { display: flex; gap: 8px; margin-top: 10px; }
    .fs-ai-row > * { flex: 1; }
    .fs-ai-status { font-weight: 600; margin-bottom: 10px; }
    .fs-ai-track { position: relative; height: 8px; border-radius: 4px; background: rgba(255,255,255,.1); overflow: hidden; }
    .fs-ai-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#22d39b,#ffb020,#ff4d6d); transition: width .4s ease; }
    .fs-ai-sweep::after {
      content: ""; position: absolute; inset: 0; width: 40%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);
      animation: fs-ai-sweep 1.1s linear infinite;
    }
    @keyframes fs-ai-sweep { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
    .fs-ai-pulse { animation: fs-ai-pulse 1s ease-in-out infinite; }
    @keyframes fs-ai-pulse { 50% { opacity: .45; } }
    .fs-ai-verdict { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; margin: 2px 0 10px; }
    .fs-ai-pct { font-size: 64px; font-weight: 900; line-height: 1; letter-spacing: -.02em; }
    .fs-ai-pct small { font-size: 28px; font-weight: 800; margin-left: 2px; }
    .fs-ai-meter { position: relative; height: 8px; border-radius: 4px; margin: 0 0 14px;
      background: linear-gradient(90deg,#22d39b,#ffb020,#ff4d6d); }
    .fs-ai-dot { position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 3px #0b0d12; transition: left .9s cubic-bezier(.2,.9,.3,1); }
    .fs-ai-level { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: 900; color: #0b0d12; font-size: 15px;
      margin-bottom: 8px; }
    .fs-ai-roast { margin: 10px 0 14px; font-size: 15px; font-weight: 600; }
    .fs-ai-stats { display: flex; justify-content: space-between; padding: 10px 0; margin-bottom: 4px;
      border-top: 1px solid rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.1); }
    .fs-ai-stats div { display: flex; flex-direction: column; gap: 2px; }
    .fs-ai-stats span { color: rgba(255,255,255,.5); font-size: 12px; }
    .fs-ai-stats b { font-size: 15px; }
    .fs-ai-row.fs-ai-share > .fs-ai-ghost { flex: 0 0 auto; width: auto; padding: 0 14px; }
    .fs-ai-tally { margin-top: 10px; color: rgba(255,255,255,.65); font-size: 12px; text-align: center; }
    .fs-ai-toast { margin-top: 10px; text-align: center; font-size: 12px; color: #22d39b; }
    .fs-ai-voted { border-color: #fff !important; background: rgba(255,255,255,.14) !important; }
    .fs-ai-error { color: #ffb020; font-weight: 600; margin-bottom: 12px; }
    .fs-ai-note { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.07);
      color: rgba(255,255,255,.75); font-size: 12px; text-align: center; }
    .fs-ai-stop { margin-top: 12px; }
    .fs-ai-mark { display: inline-flex; align-items: center; gap: 3px; height: 20px; margin-left: 6px;
      padding: 0 7px 0 6px; border-radius: 999px; font: 700 11.5px/1 system-ui, sans-serif; letter-spacing: .01em;
      border: 0; background: #d81e2f; color: #fff; flex: none; align-self: center; white-space: nowrap;
      box-shadow: 0 1px 2px rgba(0,0,0,.28); }
    .fs-ai-mark::before { content: none; }
    .fs-ai-mark svg { width: 12px; height: 12px; flex: none; }
    .fs-ai-mark[data-tone="mixed"] { background: #b45309; }
    .fs-ai-mark:hover { filter: brightness(1.1); }
    .fs-ai-mark:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    .fs-ai-entry { display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; margin-right: 4px; padding: 0; border: 0; border-radius: 50%;
      background: rgba(113,118,123,.14); color: rgb(83,100,113); opacity: .88; cursor: pointer;
      flex: none; align-self: center; }
    .x-middot-group .fs-ai-entry { margin-right: 0; }
    html[data-feedsieve-theme="dark"] .fs-ai-entry {
      background: rgba(139,152,165,.16); color: rgb(139,152,165); }
    .fs-ai-entry svg { width: 14px; height: 14px; }
    .fs-ai-entry:hover { color: #7856ff; background: rgba(120,86,255,.14); opacity: 1; }
    .fs-ai-entry:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
    article[data-fs-ai-tone="ai"] { box-shadow: inset 3px 0 0 #d81e2f; }
    article[data-fs-ai-tone="mixed"] { box-shadow: inset 3px 0 0 #ffb020; }
    [data-fs-ai-fold="1"] > :not(.fs-ai-foldbar) { display: none !important; }
    .fs-ai-foldbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px;
      color: rgb(113,118,123); font: 13px/1.4 system-ui, sans-serif; border-bottom: 1px solid rgba(113,118,123,.2); }
    .fs-ai-foldbar button { border: 0; background: none; color: rgb(29,155,240); cursor: pointer; font: inherit; padding: 0; }
    .fs-ai-foldbar button:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
}
