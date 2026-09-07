/**
 * X adapter 能力快照（非破坏性探测）。
 *
 * 能力只来自可观测信号，绝不为了「探测端点是否可用」而预先执行破坏性操作：
 * - CSRF / 会话：读 cookie（ct0 可用性）加上最近真实操作是否出现认证类失败
 * - block / unblock：最近一次真实操作的结构化结果（15 分钟窗口）
 * - userIdResolution：最近一次 UserByScreenName 的底层原因
 * - timelineParsing：内容脚本最近扫描是否持续成功（由 content 侧喂入）
 *
 * 用途：X 侧契约碎片化变化时让扩展干净降级 —— 检测与标注继续，
 * 破坏性操作暂停并在 popup 说明原因（「检测正常但 Block 暂不可用」）。
 */

import { readCsrfToken } from './actions/block';

export type OpState = 'unknown' | 'working' | 'degraded' | 'failed' | 'unsupported';

export interface XAdapterCapabilities {
  /** 登录会话可用（未被认证类失败污染） */
  sessionUsable: boolean;
  /** 页面能读到 ct0 CSRF（开 block 接口的前置条件） */
  csrfAvailable: boolean;
  block: OpState;
  unblock: OpState;
  userIdResolution: OpState;
  timelineParsing: OpState;
  /** Unix ms：最近一次观测更新时间 */
  updatedAt: number;
}

/** 观测窗口：15 分钟内无新结果就回到 unknown（契约可能已恢复，重新实测）。 */
const TRACE_WINDOW_MS = 15 * 60 * 1000;

type TraceKind = 'block' | 'unblock' | 'resolve' | 'timeline';

interface OpTrace {
  at: number;
  ok: boolean;
  reason: string;
  statusCode?: number;
}

/** 模块级环形观测；扩展单实例，无并发写问题。 */
const traces: Record<TraceKind, OpTrace[]> = {
  block: [],
  unblock: [],
  resolve: [],
  timeline: [],
};

function pushTrace(kind: TraceKind, trace: OpTrace): void {
  const list = traces[kind];
  list.push(trace);
  if (list.length > 30) list.shift();
}

function freshTraces(kind: TraceKind): OpTrace[] {
  const cutoff = Date.now() - TRACE_WINDOW_MS;
  const list = traces[kind].filter((trace) => trace.at >= cutoff);
  traces[kind] = list;
  return list;
}

/** block / unblock 的真实操作结果（由 runNativeAction 回填）。 */
export function noteActionResult(
  kind: 'block' | 'unblock',
  outcome: { ok: boolean; code?: string; statusCode?: number },
): void {
  pushTrace(kind, {
    at: Date.now(),
    ok: outcome.ok,
    reason: outcome.ok ? 'ok' : (outcome.code ?? 'unknown'),
    statusCode: outcome.statusCode,
  });
}

/** UserByScreenName 的底层原因（由 resolve-user-id 回填，区分「查无此人」与「解析失败」）。 */
export function noteResolveTrace(
  reason: 'ok' | 'no_csrf' | 'http' | 'network' | 'unavailable' | 'parse' | 'rate_limited',
): void {
  pushTrace('resolve', {
    at: Date.now(),
    ok: reason === 'ok' || reason === 'unavailable',
    reason,
  });
}

/** 内容脚本每次扫描的心跳（由 content script 喂入）。 */
export function noteTimelineHealth(ok: boolean, reason = 'ok'): void {
  pushTrace('timeline', { at: Date.now(), ok, reason });
}

function latestState(kind: TraceKind, classify: (latest: OpTrace) => OpState): OpState {
  const fresh = freshTraces(kind);
  if (fresh.length === 0) return 'unknown';
  return classify(fresh[fresh.length - 1]!);
}

function nativeActionState(latest: OpTrace): OpState {
  if (latest.ok) return 'working';
  switch (latest.reason) {
    case 'rate_limited':
    case 'network_error':
      // 瞬时故障：端点本身可能正常
      return 'degraded';
    case 'http_error':
      // 端点被移除/换契约 = X 侧结构性变化，属于不兼容而非可恢复故障
      return latest.statusCode !== undefined && [404, 405, 410].includes(latest.statusCode)
        ? 'unsupported'
        : 'failed';
    case 'auth_required':
    case 'missing_csrf':
      return 'failed';
    default:
      return 'failed';
  }
}

function resolveState(latest: OpTrace): OpState {
  // 查无此人 = 解析流程正常工作的确定结论
  if (latest.ok) return 'working';
  return latest.reason === 'no_csrf' || latest.reason === 'network' || latest.reason === 'rate_limited'
    ? 'degraded'
    : 'failed';
}

function timelineState(latest: OpTrace): OpState {
  return latest.ok ? 'working' : 'degraded';
}

/** 读当前能力快照（调用时取 15 分钟窗口内的观测 + 当前 cookie 状态）。 */
export function readCapabilities(): XAdapterCapabilities {
  const csrfAvailable = readCsrfToken() !== null;
  const authFailed = (kind: TraceKind): boolean =>
    freshTraces(kind).some(
      (trace) => trace.reason === 'auth_required' || trace.reason === 'missing_csrf',
    );
  return {
    sessionUsable: csrfAvailable && !authFailed('block') && !authFailed('resolve'),
    csrfAvailable,
    block: latestState('block', nativeActionState),
    unblock: latestState('unblock', nativeActionState),
    userIdResolution: latestState('resolve', resolveState),
    timelineParsing: latestState('timeline', timelineState),
    updatedAt: Date.now(),
  };
}

/** 扩展端判断「破坏性操作是否应暂停」的统一入口（popup 与 content 共用同一口径）。 */
export function shouldPauseDestructive(capabilities: XAdapterCapabilities): boolean {
  return (
    capabilities.block === 'failed' ||
    capabilities.block === 'unsupported' ||
    !capabilities.sessionUsable ||
    !capabilities.csrfAvailable
  );
}