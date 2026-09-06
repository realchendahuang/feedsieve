# 更新日志 / Changelog

本项目所有显著变更都记录在这个文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

- 每个版本的详细工程记录见 [`docs/RELEASES.md`](docs/RELEASES.md)。
- 二进制产物见 [GitHub Releases](https://github.com/realchendahuang/feedsieve/releases)；正式用户请从 [Chrome 应用商店](https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph)接收更新。

## [Unreleased]

暂无。

## [0.7.5] — 2026-09-03

### 新增

- 弹窗第二页「概览」：汇总今日与累计的识别、拉黑、撤销数据。
- React + TanStack Router 维护后台（名单草稿、词库规则、反馈、发布与回滚），仅接受 Cloudflare Access 的 JWT 身份断言。

### 变更

- 弹窗信息收紧：删除副标题与重复说明，必要说明收进 `!` 悬浮提示；中文成为默认语言。
- 名单与词库均须显式发布才更新公开快照。

### 修复

- 悬浮提示靠近边界时被裁剪的问题；瞬时成功反馈自动消失。

## [0.7.4] — 2026-09-02

### 变更

- 「黄推 / 成人引流」行业包扩充到 629 条，8 个行业包共 778 条公开规则，默认全部开启、可整包或逐条关闭。
- 有序分词匹配：完整短语忽略用于规避的空格、标点、符号和 emoji；「同城 + 上门」一类有序组合允许中间插入少量文字。
- 词库不随扩展发版：X 页面每 15 分钟、回前台及手动操作时检查 R2 规则版本，校验失败保留上一次可信版本。

## [0.7.3] — 2026-09-02

### 修复

- 页面上所有可见黄标都会进入「当前页面」清单并可一键批量拉黑；关键词命中仍不自动拉黑，最终动作由用户决定。
- 昵称、账号名、正文与简介全部参与关键词匹配，补上「话术只写在名字里」的漏识别。

### 变更

- 首次安装默认启用全部 8 个行业包，分类开关直接放在第一层。
- 成人引流包补充「同城上门约炮」等 12 条昵称 / 话术规则。

## [0.7.2] — 2026-09-02

### 新增

- 行业词库订阅：按黄推 / 投资诈骗 / 加密骗局 / 兼职刷单 / 贷款诈骗 / 博彩引流 / 互动诱导 / 通用营销拆成 8 个包，126 条可审计完整话术入库。
- 词库经 Cloudflare R2 版本化分发，manifest、checksum 与 schema 三重校验，原子更新，失败回退 last-known-good。
- 开放发布链路：`pnpm keyword-packs:build / check / publish`，词库与生成物均入库，git diff 即审计记录。

## [0.7.1] — 2026-09-01

### 变更

- 弹窗重做为 420×600 工作区，三页导航（清理 / 名单 / 设置）；每块只留一个标题。
- 误标白名单独立成页，直接显示账号、加入日期、命中来源与当时的检测理由。
- 「误标？」同时上报社区纠错证据；网络失败不影响本地白名单的一票否决。

### 修复

- 数字账号误标收紧；引用帖证据隔离；本地复读必须至少 3 个不同账号使用同一指纹。
- 新增当前判断唯一计票（active_labels）：每次改判覆盖前一次，撤销即撤票。

### 安全

- 后台误标审计接口按规则汇总反馈，不返回安装标识、不存推文原文。
- 升级与重启时分批补传本机历史黑白名单。

## [0.7.0] — 2026-08-31

### 新增

- Chrome Web Store 首次提交版：全套商店素材、发布流水 `scripts/pack-store.sh`（verify → 构建 → zip → 审计 → SHA-256）、双语隐私政策 [PRIVACY.md](PRIVACY.md)。

### 修复

- popup「页面黄框」查询的消息链路（onMessage 改为 Promise 异步响应）。

### 安全

- 贡献统计零打扰：从未上报过的设备不发任何请求；原始 UUID 不进 URL；host 权限收敛为 x.com + 官方 API。

## [0.6.1] — 2026-08-30

### 新增

- 战报卡片分类占比条形图；「替你少看了多少垃圾时间」估算。
- canvas 生成 1200×630 品牌分享卡片，popup 预览 + 下载 PNG。
- 社区贡献统计（按安装哈希查询，纯数字返回，隐私隔离）。

## [0.6.0] — 2026-08-30

### 新增

- 今日战报：实时「送走 N 个垃圾号」+ 分类明细，按日累计（30 天滚动保留）。
- 一键分享到 X：战报文案生成器 + x.com intent 链接，不新增任何权限。

## [0.5.0] — 2026-08-30

### 新增

- SimHash 64bit 模糊指纹：指纹从精确哈希升级为位向量，汉明距离 ≤ 2 判定「话术变体」，换号换词也能认出。
- Campaign 实体：服务端按指纹聚类（≥ 2 账号成簇），标注显示「同模板 N 个账号」。

## [0.4.0] — 2026-08-30

### 新增

- 内容指纹与外链域名声誉：≥ 2 个独立安装上报同一指纹 / 域名才下发，仅在「大扫除」档参与标注。
- 本地复读追踪（会话内 ≥ 3 次）、已拉黑账号回显、抢救票、改名别名、策略透明（`/v1/policy`）。

## [0.2.0] — 2026-08-28

### 新增

- 社区名单闭环：Cloudflare Workers + D1 后端（匿名上报、聚合、版本化快照、人工审核闸门），开源可自部署。
- 扩展消费端：快照同步 + SHA-256 校验 + last-known-good 离线缓存；本地索引查询，滚动时间线零请求。
- 标注强度三档（清爽 / 标准 / 大扫除）；拉黑成功自动匿名贡献；个人白名单一票否决；已拉黑回显。

### 安全

- 自动化最高到 candidate，recommended / strong 必须人工提升；上报只存安装 ID 的加盐哈希，绝无浏览数据。

## [0.1.0] — 2026-08-27

### 新增

- 首个可用版本：黄框标注（内置名单 + 启发式，带理由）、顺手拉黑、待拉黑列表、一键批量拉黑（持久队列）、一键撤销、本地统计。
- WXT + React 19 + MV3 最小权限架构；X DOM fixtures 锁定 reader→detector 契约；95 个单元测试；pre-push 本地质量门禁。

[Unreleased]: https://github.com/realchendahuang/feedsieve/compare/v0.7.5...HEAD
[0.7.5]: https://github.com/realchendahuang/feedsieve/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/realchendahuang/feedsieve/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/realchendahuang/feedsieve/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/realchendahuang/feedsieve/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/realchendahuang/feedsieve/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/realchendahuang/feedsieve/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/realchendahuang/feedsieve/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/realchendahuang/feedsieve/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/realchendahuang/feedsieve/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/realchendahuang/feedsieve/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/realchendahuang/feedsieve/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/realchendahuang/feedsieve/releases/tag/v0.1.0
