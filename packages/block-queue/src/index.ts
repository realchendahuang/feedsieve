/**
 * 执行状态机与失败分类的唯一出口。
 *
 * 持久化适配器由宿主注入（见 runner.ts）；历史上曾有过一版内存态
 * BlockQueue 状态机（types.ts/queue.ts），已被 runner + 持久化存储取代，
 * 连同其测试一并移除——不要在新代码里再引入第二套任务状态词汇。
 */
export * from './failure';
export * from './runner';