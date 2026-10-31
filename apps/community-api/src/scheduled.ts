/**
 * 定时任务编排（自 index.ts 抽出）：快照日更 + 热榜清理 + 死账号探活。
 * 供 server.ts（生产入口）调用；测试走 api-entry（cloudflare vitest 无法加载
 * TanStack Start 的虚拟 server-entry 模块，cron 不经它）。
 */
import {
  killSwitchNeedsPublish,
  generateSnapshot,
  cleanupOldSnapshots,
  markSnapshotDirty,
  readSnapshotDirty,
  clearSnapshotDirty,
} from './snapshot';
import { lt, sql } from 'drizzle-orm';
import { describeDbError, getDb } from './db/client';
import { trainingSampleUsage } from './db/schema';
import { cleanupHotData } from './hot';
import { cleanupProfileCounters } from './profiles';
import { autoMuteNoisyRules, cleanupRuleHits } from './rule-hits';

/** 每小时整点跑全量编排；其余 cron（半点）只发快照，让新上榜的号半小时内下发。 */
export const FULL_CRON = '0 * * * *';

// 定时发布是异步化的消费端：有脏标记才生成；内容未变时复用版本并清除标记。
// 生成失败不清标记 → 下一周期自然重试；生成期间到达的新变更（值已变）也保留。
export async function scheduledAutoPublish(env: Cloudflare.Env): Promise<void> {
  try {
    const dirty = await readSnapshotDirty(env);
    if (dirty != null) {
      const published = await generateSnapshot(env);
      // 距上一版太近时 generateSnapshot 返回 deferred：脏标记保留，下一轮 cron 合并发布。
      if (!published.deferred) {
        await clearSnapshotDirty(env, dirty);
      }
      console.info(
        `[community-api] cron publish: version=${published.version}${published.deferred ? ' (deferred)' : ''}`,
      );
      return;
    }
    // 无票面变更但官方暂停开关被部署配置翻转（开/关/理由变更）：仍需公开，
    // 发布间隔守卫在 generateSnapshot 内部把关。
    if (await killSwitchNeedsPublish(env)) {
      const published = await generateSnapshot(env);
      console.info(`[community-api] cron publish (kill switch): version=${published.version}`);
    }
  } catch (error) {
    console.error(`[community-api] cron publish failed: ${describeDbError(error)}`);
  }
}

/**
 * cron 全量编排：快照日更 + 死账号定向探活。
 * 抽成单函数供两个环境入口共用（index.ts 测试入口 / server.ts 生产入口）：
 * 新增定时消费端只改这里，别再出现 server 独有探活而 index 静默丢掉的漂移
 * （2026-09-12 体检发现的隐患）。
 */
/** 只发快照的轻量 cron；其余（包括本地手动触发传空串）一律走全量编排。 */
export const PUBLISH_ONLY_CRON = '30 * * * *';

export async function runScheduledCron(env: Cloudflare.Env, cron = FULL_CRON): Promise<void> {
  if (cron === PUBLISH_ONLY_CRON) {
    await scheduledAutoPublish(env);
    return;
  }
  // Retain evidence and review history; only expire obsolete request quota counters.
  await getDb(env)
    .delete(trainingSampleUsage)
    .where(
      lt(
        trainingSampleUsage.day,
        sql`to_char((now() at time zone 'utc') - interval '7 days', 'YYYY-MM-DD')`,
      ),
    );
  // 全站热榜只需要最近 48 小时的观测；失败只记日志，下小时重试
  await cleanupHotData(env).catch((error) =>
    console.error(`[community-api] cron hot cleanup failed: ${describeDbError(error)}`),
  );
  await cleanupProfileCounters(env).catch((error) =>
    console.error(`[community-api] cron profile counter cleanup failed: ${describeDbError(error)}`),
  );
  await cleanupOldSnapshots(env).catch((error) =>
    console.error(`[community-api] cron snapshot cleanup failed: ${describeDbError(error)}`),
  );
  await cleanupRuleHits(env).catch((error) =>
    console.error(`[community-api] cron rule hit cleanup failed: ${describeDbError(error)}`),
  );
  // 规则误伤闭环：误伤率超线的规则静音，随这一轮快照下发
  await autoMuteNoisyRules(env)
    .then((muted) => {
      if (muted.length > 0) console.info(`[community-api] auto-muted rules: ${muted.join(', ')}`);
    })
    .catch((error) =>
      console.error(`[community-api] cron rule auto-mute failed: ${describeDbError(error)}`),
    );
  // 规则命中每时每刻都在进来（佐证上榜、分类会变）：整点无条件重算一次，内容没变就复用版本
  await markSnapshotDirty(env).catch(() => undefined);
  await scheduledAutoPublish(env);
  const { probeAccountHealthScheduled } = await import('./prober');
  await probeAccountHealthScheduled(env);
}
