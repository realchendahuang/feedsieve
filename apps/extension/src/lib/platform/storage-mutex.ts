/**
 * chrome.storage 读-改-写互斥（review F2）。
 *
 * storage 没有事务：两个并发 read-modify-write 都会读到同一份数组，后写者覆盖
 * 前写者的新增条目 —— 典型场景是单条拉黑（手动按钮）与队列拉黑并发完成，丢掉
 * 其中一笔撤销记账。模块级 Promise 链把整段读改写串行化；某次失败不影响后续
 * 排队写入（调用方自己拿原始 rejection）。
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function enqueueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {
    // 吞掉让后续写不受前次失败影响；调用方自己拿原始 rejection
  });
  return next;
}
