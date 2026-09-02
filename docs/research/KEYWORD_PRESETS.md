# 开源关键词词库：订阅、更新与审计

当前公开版本：`2026.09.02.2`。词库包含 **8 个可订阅行业包、126 条完整短语**，源文件在 [`community/keyword-packs/source.json`](../../community/keyword-packs/source.json)，不是藏在扩展代码里的黑箱规则。

## 用户侧行为

| 词库包              |    条数 | 命中后的行为                                     |
| ------------------- | ------: | ------------------------------------------------ |
| 黄推 / 成人引流     |      15 | 黄标 + 人工“标记垃圾并拉黑”入口                  |
| 投资 / 带单诈骗     |      20 | 同上                                             |
| 加密货币骗局        |      18 | 同上                                             |
| 兼职刷单 / 任务诈骗 |      18 | 同上                                             |
| 贷款 / 解冻诈骗     |      18 | 同上                                             |
| 博彩 / 赌场引流     |      12 | 同上                                             |
| 互动诱导            |      13 | 同上                                             |
| 通用营销引流        |      12 | 同上                                             |
| **总计**            | **126** | **从不自动拉黑、从不进入一键清理、从不上报社区** |

用户必须先在「设置 → 关键词规则」订阅某个包，未订阅包的词不会参与匹配。订阅后仍可对单条规则关闭或恢复；自定义词继续只保留在本机。

## 不依赖扩展发版的更新链路

```text
source.json（Git 提交、PR 审阅）
        ↓ pnpm keyword-packs:build
official.json + manifest.json（固定版本、SHA-256）
        ↓ pnpm keyword-packs:publish
Cloudflare R2 的 keyword-packs/<version>/official.json
        ↓ Worker 只读分发
扩展启动 / 每 6 小时 / 用户手动同步
        ↓ manifest + SHA-256 + schema 校验
storage.local 的 last-known-good 缓存，立刻重扫 X 页面
```

所以更新一个词库只涉及公开数据与 R2 产物的发布；**用户不需要更新扩展**。网络、R2 或校验失败时，扩展继续使用上一次通过校验的本地版本；首次离线安装则用构建时打包的 `official.json`。

维护者流程：

```sh
# 编辑唯一来源，然后生成并检查提交物
pnpm keyword-packs:build
pnpm keyword-packs:check

# 审阅 source.json、official.json、manifest.json 的 Git diff 后提交

# 已创建 R2 bucket 后发布；不会改动源文件
pnpm keyword-packs:publish
```

R2 对象约定：

- `keyword-packs/latest.json`：短缓存 manifest
- `keyword-packs/<pack_version>/official.json`：不可变的版本化产物
- Worker 端点：`GET /v1/keyword-packs/latest` 和 `GET /v1/keyword-packs/:version/official.json`

## 收录依据

词库不整包复制任何外部数据集。开源社区数据集用于观察垃圾消息的类别、写法和遗漏面，公开反诈机构资料用于核验诈骗话术；每条最终规则必须是可见、可关闭的完整短语。

- [国家金融监督管理总局风险提示（建行转载）](https://www2.ccb.cn/chn/2025-04/26/article_2025042600332684078.shtml)：保本高息、稳赚不赔、内幕消息、高返利等投资诱导。
- [中国证监会宁夏监管局风险提示](https://www.csrc.gov.cn/ningxia/c104435/c7618685/7618685/files/AI%E6%99%BA%E8%83%BD%E6%8A%95%E8%B5%84%E2%80%9D%E7%A8%B3%E8%B5%9A%E4%B8%8D%E8%B5%94%EF%BC%9F%E5%B0%8F%E5%BF%83%E9%99%B7%E9%98%B1%EF%BC%81.pdf)：AI 投资、高收益项目、保本保息、日收益等承诺型骗局。
- [FTC：任务诈骗](https://consumer.ftc.gov/consumer-alerts/2024/11/task-scams-create-illusion-making-money)：点赞/评价任务、佣金和充值解锁类骗局。
- [上海警方：求职类诈骗](https://www.shanghai.gov.cn/nw31406/20260701/8292a7dd813041d182f4ed83e8a73449.html)：刷单返利、卡单解冻、保证金、高薪包就业、培训费等。
- [FTC：加密货币骗局](https://consumer.ftc.gov/articles/what-know-about-cryptocurrency-scams)：免费加密货币与保证回报的诱导模式。
- [FBS_SMS_Dataset](https://github.com/Cypher-Z/FBS_SMS_Dataset)、[BanHarassment](https://github.com/vlongen/BanHarassment)、[SpamMessage](https://github.com/hrwhisper/SpamMessage)：公开社区垃圾消息资料，只做类别与表达方式参考，不直接导入原始语料。

## 明确不收录

- 单个泛词，例如“群”“免费”“老师”“福利”“空投”；这些词在正常讨论中出现太多。
- 政治立场、观点、身份、兴趣或任何与垃圾行为无关的词。
- 未订阅就匹配的远程规则，或命中后自动拉黑、隐藏、进入批量队列、上报社区的规则。
- 不可解释的模型分数、昵称猜测和“模板复读”等内部术语。

新增规则必须同时更新公开来源、稳定 ID、行业包、测试样本和生成物；用户可以通过 Git diff、R2 manifest 的版本和扩展设置里的版本号复核每一次改动。
