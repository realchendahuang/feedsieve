# FeedSieve 项目约定

## 社区后端数据库（apps/community-api）

- PostgreSQL 经 Hyperdrive 接入，ORM 用 Drizzle。不要写字符串拼接的 SQL；构造器表达不了的用 `` sql`…` `` 模板，值一律参数化。
- 改表：改 `src/db/schema.ts` → `pnpm db:generate --name <名字>` → 审阅 `drizzle/` 下的 SQL（要回填数据就写进迁移）→ 和代码一起提交。
- 业务代码用 `getDb(env)` 取连接，入口已用 `withDb` 包好作用域；新增入口（新的 fetch / scheduled 处理）也必须包 `withDb`。
- 数据表示保持约定：时间戳是 Unix 秒（热帖是毫秒），开关是 0/1 整数，JSON 存 text 列。
- 写库的客户端自由文本先过 `stripNul`；多行 UPSERT 先按主键排序；文本排序进快照或签名的加 `collate "C"`。
- 测试连本地 PostgreSQL（仓库根目录 `docker compose up -d postgres`），`pnpm verify` 会自动起。

## 弹窗界面

- 页面只保留能帮助用户完成当前操作的信息：标题、数据、控件，以及操作后的结果或错误反馈。
- 不允许在任何页面出现副标题、说明性段落、营销文案或重复解释；控件本身应通过清晰命名表达用途。
- 必要的辅助说明必须收进相关标题或控件旁的 `!` 小图标，且仅在悬浮该图标时显示。
- 仅在用户正在执行操作或需要处理异常时显示状态反馈。瞬时成功提示必须自动消失，不能持续遮挡界面。

## 提交

- 每完成一组能独立说明的改动，立刻 `git commit`，不要攒在工作区等用户提醒。
- 提交信息用 `<type>(<scope>): <摘要>`（如 `fix(insight): …`），正文写清用户能感知的变化。
- `git push`、发版、部署仍然只在用户明确要求时做；commit 本身不需要再问。

## 提交前

- `pnpm verify`（lint + typecheck + 全量单测 + 扩展构建）必须通过。
- 涉及名单的改动要过 `community/schema/` 校验，不要手改运行时快照。
- 新增上传字段、权限、域名时，同步更新 `PRIVACY.md`。

> 维护者的内部资料（部署拓扑、成本、调研）在 `docs/internal/`，不入库。
