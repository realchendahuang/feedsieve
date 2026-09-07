# Skill: feedsieve-feature-ingest — 特征帖入库（分析 → 线上词库/名单 → 发布 → 用户更新）

项目级 skill。输入：用户发来的**特征帖子**（链接 / 截图 / 文案，通常是一批同模板垃圾号）。输出：线上即刻生效的
词库关键词规则 + 维护者名单条目（扩展端 15 分钟内拉到，无需发版），并把「内容结构类」特征沉淀进 detector
启发式 + 金标语料（随下次扩展发版生效）。

依赖：本仓库 `.agents/skills/feedsieve-admin/` 的 `m.sh`（端点 / 鉴权 / 红线全在它那里），
走它封装好的 `status / klist / krule / kpub / put / find`；脚本不用重复造。

```sh
ADMIN=../feedsieve-admin/m.sh   # 在本 skill 目录下执行时的相对路径
```

## 一、一次入库的标准流程（先分析，再动手）

1. **抓样本**：特征帖有链接就 `WebFetch https://x.com/<handle>/status/<post_id>` 拿原文
   （注意保留**换行结构**——这类垃圾号正文常是每行一词 + emoji 行；转 markdown 可能压行，必要时用
   guest API 验端点复核）。没链接就从截图/文案里提取 handle 与正文。
2. **拆特征**（一份样本拆成三类，分别走不同通道）：
   | 特征 | 例（2026-09-07 单词沙拉黄推集群） | 落点 | 生效方式 |
   | --- | --- | --- | --- |
   | 账号实例 | `rtobadj473` | 名单 `put`（note + evidence） | 快照立即发布，全用户 block-candidate（可一键批量拉黑） |
   | 昵称/简介话术（**短语**） | 「专业牵线」「全国1-5线覆盖」 | 词库规则 `krule` → `kpub` | 扩展 ≤15min 拉到，review 层黄框 |
   | 正文**结构形状** | 5 行随机小写英文词 + 1 个 emoji | detector 启发式 + 金标语料 | 随扩展发版生效 |
   | emoji / 单个普通单词单独出现 | ✅ ⭐ 😘、hard、fire | ❌ 不加 | 误伤面大；单词全是字典词，词库规则做不了 |
3. **词库规则怎么定**：`klist` 查重（同义是否已有规则）→ 规则 id 用可读 slug（`adult-xxx` 风格）
   → phrase 用**观察到的原话**。匹配实现会剥离标点/emoji/空白并小写（「全国1-5线覆盖」匹配时
   等价「全国15线覆盖」），所以不用写规避变体。
4. **发布**：词库改动必须显式 `kpub`（签名 + R2 产物 + 版本号递增）；名单 `put` 每次自动发布新快照。
5. **验证**（线上闭环必做，含防缓存坑）：
   - `kpub` 后用 `status` 看新 `pack_version`；再拉版本化产物
     `GET /v1/keyword-packs/<new-version>/official.json`，确认新规则在、签名在。
   - `put` 后拉 `GET /v1/snapshots/<new-version>/official.json`，确认 handle 在、note/evidence 对。
   - **缓存坑**：`/v1/keyword-packs/latest` 和 `/v1/snapshots/latest` 走 Cloudflare 边缘缓存
     （`cache-control: public, max-age=300`），发布后裸 URL 会短暂指向旧版本。
     验证时带 `?<随机数>` 强刷即可确认 worker 已更新；**镜像脚本用裸 URL，必须等 TTL（≤5 分钟）再跑**，
     否则会把旧版镜象进仓库。
6. **镜像留档**：`scripts/mirror-community-lists.sh` → 校验输出的 `snapshot_version` 是新版且
   含新增 handle → `git add community/lists && git commit`。
7. **结构类特征**（如有）：在 `packages/detector/src/heuristics.ts` 加保守规则（宁可漏判，
   强误伤面就用双信号佐证），同时在 `packages/detector/corpus/cases.json` 加**正样本 + 误伤守卫样本**
   （修改时保持原 JSON 格式：2 空格缩进、`input` 单行内联、case 间无空行、仅最后一个 case 无尾逗号），
   跑 `pnpm test` 全绿 + `CORPUS_REPORT=1` 刷 metrics，随扩展发版。

## 二、经验与约束（来自 2026-09-07 实单）

- **线上词库通道只能表达短语/有序词**：`textForMatch` 会先把标点、emoji、空白全部剥离再匹配，
  所以「单词沙拉」这类**结构形状**（每行一个随机词 + emoji、无标点无链接）在线上通道做不了；
  想做只能走 detector 启发式（发版生效）。判定时先想：这是「账号说了什么话」还是「账号的帖子长什么样」。
- **结构与昵称双信号**：单词沙拉规则必须佐证账号侧（引流隐语昵称/简介），否则会命中真实「心情贴」
  （`some days feel 🖤 hollow`）。宁缺毋滥；干净昵称的同类由社区指纹/SimHash 变体层兜底。
- **生效层级**：词库关键词命中 = review（黄框待用户确认，不回灌社区票）；名单命中 = block-candidate
  （一键批量拉黑）。给用户解释时区分「这个账号现在就能拉黑」与「同类账号会黄框提醒」。
- **发布前查重**：`klist` 对一眼，已有的（如「全国空降」与「全国1-5线覆盖」不同义）别重复加。

## 三、红线（继承 feedsieve-admin）

- 只动维护者名单条目与词库；绝不伪造/修改社区票、计票字段。
- 名单条目必须带公开 note（为什么进名单）与 evidence（举报帖数字 ID）。
- Agent key 只从环境变量 / `~/.config/feedsieve/agent.key` 读取，绝不写入仓库、Skill 文档、提交或对话。