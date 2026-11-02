/**
 * 快照的键名与包名：只需要字符串、不需要生成逻辑的地方从这里取。
 *
 * 拆出来的理由：上报端点（reports / rescues / labels）收尾时只写一个脏标记、
 * 读一个版本指针，却因为这两个常量来自 snapshot.ts，把整个快照模块
 * （生成、签名、YAML）拉进了每一次 `/v1/*` 的冷启动。
 */
/** 快照脏标记（meta 表键）：有值说明内容变了，cron 下一轮重新生成。 */
export const SNAPSHOT_DIRTY_KEY = 'snapshot_dirty';
/** 最新版本指针（meta 表键）：O(1) 点读，取代每次全表排序扫。 */
export const SNAPSHOT_LATEST_KEY = 'latest_snapshot_version';
/** 机器可读快照包名。 */
export const SNAPSHOT_PACK = 'official.json';
/** 可读公开名单包名。 */
export const PUBLIC_BLOCKLIST_PACK = 'blocklist.yaml';
