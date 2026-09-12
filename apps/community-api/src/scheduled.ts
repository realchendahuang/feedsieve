/**
 * 定时任务编排（自 index.ts 抽出）：快照日更 + 打野赛季结算。
 * 供 server.ts（生产入口）调用；测试走 api-entry（cloudflare vitest 无法加载
 * TanStack Start 的虚拟 server-entry 模块，cron 不经它）。
 */
import { killSwitchNeedsPublish, generateSnapshot, readSnapshotDirty, clearSnapshotDirty } from './snapshot';
import { settleDueSeasons } from './leaderboard';

// 定时发布是异步化的消费端：有脏标记才生成；内容未变时复用版本并清除标记。
// 生成失败不清标记 → 下一周期自然重试；生成期间到达的新变更（值已变）也保留。
export async function scheduledAutoPublish(env: Cloudflare.Env): Promise<void> {
  try {
    const dirty = await readSnapshotDirty(env);
    if (dirty != null) {
      const published = await generateSnapshot(env);
      // 当日已有一版而内容又有变化时 generateSnapshot 返回 deferred：
      // 脏标记保留到下一自然日再由 cron 合并发布（day-once 日更语义）。
      if (!published.deferred) {
        await clearSnapshotDirty(env, dirty);
      }
      console.info(
        `[community-api] cron publish: version=${published.version}${published.deferred ? ' (deferred to next day)' : ''}`,
      );
      return;
    }
    // 无票面变更但官方暂停开关被部署配置翻转（开/关/理由变更）：仍需公开，
    // day-once 守卫在 generateSnapshot 内部把关（当日已发布则顺延）。
    if (await killSwitchNeedsPublish(env)) {
      const published = await generateSnapshot(env);
      console.info(`[community-api] cron publish (kill switch): version=${published.version}`);
    }
  } catch (error) {
    console.error('[community-api] cron publish failed:', error);
  }
}

// 打野排位赛：跨周结算（称号发放）。失败只记日志，下小时重试。
export async function settleSeasonsScheduled(env: Cloudflare.Env): Promise<void> {
  try {
    const settled = await settleDueSeasons(env);
    if (settled > 0) console.info(`[community-api] cron settled seasons: ${settled}`);
  } catch (error) {
    console.error('[community-api] cron season settle failed:', error);
  }
}
