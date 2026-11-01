# AMO 上架材料（0.13.1）

2026-11-02 已按本文件提交 **0.13.2**：<https://addons.mozilla.org/zh-CN/firefox/addon/feedsieve-fuluwa/>，状态「等待审核」。slug 为 `feedsieve-fuluwa`，名称为「FeedSieve 福滤娃」。

官方 Firefox 条目使用 Gecko ID `feedsieve-official@feedsieve.win`。AMO 上已有的
`feedsieve@feedsieve.local` / 0.8.2 条目是第三方转载，`feedsieve@feedsieve.win`
也被对方占成了非公开条目（上传时报重复 ID），所以官方另用 `-official` 地址；
提交时不要选择「更新已有条目」，而是新建条目。

## 名称

使用：`FeedSieve 福滤娃`

如果 AMO 因已有同名条目要求区分，再临时加后缀：`FeedSieve 福滤娃（官方）`。

## 简短描述

```text
评论区不骚了，好帖也不漏了。黄推标出一键原生拉黑；流速与量级、热帖榜、博主爆款分析、定时排期与文章 Markdown，中文 X 副驾驶。
```

## 详细描述

```text
用了福滤娃，评论区不骚了，好帖也不漏了。

福滤娃（FeedSieve）是开源的中文 X（Twitter）刷推副驾驶：评论区里的黄推和引流号帮你标出来、一键拉黑；正在火的帖子和值得研究的博主，帮你一眼看清。

【清干净：只框不藏，拉黑交给你】
• 垃圾账号在时间线上打黄框，写明理由，推文原样保留，绝不擅自隐藏
• 点一下走 X 原生拉黑，手机、平板、电脑同步生效
• 关注的人自动保护；拉错了在「已拉黑」里一键放回
• 批量拉黑有每日配额和随机间隔，遇到 X 限流立即停下

【看得准：每条帖子的热度一眼可见】
• 推文右上角显示每小时浏览数，正在火的变红；作者名旁显示量级和粉丝数
• 「热帖」汇总你最近在所有 X 标签页刷到的火帖，可按热度、回复机会、粉丝数、收藏数、最近刷到排序
• 「全站热榜」汇总其他用户刷到的火帖，分「飙升」和「24 小时」两个榜

【测 AI 味：这条回复是不是 AI 写的】
• 点回复上的机器人图标，或打开博主主页的「AI 味」Tab，读取最近公开回复并给出 AI 味百分比和锐评
• 社区投票至少 3 票且领先才公开结论；两边持平显示「社区争议中」；不再由维护者人工复核
• 已有结论的号在评论区标「AI 味 N%」，可改成折叠或关闭

【发得顺：发帖节奏和长文写作】
• 设好集中发帖时段和每小时最多几条，系统按小时生成名额，分钟在小时内随机
• 面板「发帖」点「排下一条」，X 的安排表自动填好时间，你只点确认
• 按天查看每小时「已排 / 上限」，已排期和待确认分开显示
• X 文章编辑器里粘贴 Markdown 自动排版，右下角显示字数、阅读时长和大纲

【挖得深：打开任意博主主页】
• 爆款倍数：每条帖子的浏览是他自己中位数的几倍，3 倍以上标金色
• 爆款率、各内容形式（纯文字 / 图片 / 视频 / 引用）和发帖时段的表现
• 疑似投流的帖子单独标出，不算进爆款
• 一键在 X 搜他的高赞帖、复制 Top 20 给 AI 分析、导出 CSV

【不越界】
• 只读 X 已经加载给你的数据，不额外请求 X；只有你点了「测 AI 味」时，才在那个账号的回复页往下翻几屏
• 热帖和主页数据存在本机，可随时一键清空
• 发帖、排期、发布文章永远由你自己点最后一下
• 黑名单、词库全部公开，可在设置里分别关闭上报

开源仓库：https://github.com/realchendahuang/feedsieve
官网：https://feedsieve.win
隐私政策：https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md
```

## Listing 字段

- 类别：Privacy & Security（隐私与安全）
- 标签：`twitter`, `x`, `social media`, `privacy`, `blocklist`
- 许可证：MIT
- 主页：https://feedsieve.win/
- 支持：https://github.com/realchendahuang/feedsieve/issues
- 隐私政策：https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md
- 平台：仅桌面 Firefox（不勾 Android）
- 最低版本：Firefox 140

## 数据收集声明

manifest 声明四类，AMO 表单按此勾选：

- websiteContent（网站内容）
- websiteActivity（用户活动）
- personallyIdentifyingInfo（唯一标识 / 公开账号信息）
- authenticationInfo（认证信息：仅在你点击拉黑时从页面 Cookie 读取 ct0，随请求发给 x.com 本身，不发给 FeedSieve）

## 审核员说明

```text
FeedSieve is an open-source X (x.com) assistant. The submitted package is built
from the bundled full-source archive with:

  pnpm install --frozen-lockfile
  pnpm --filter @feedsieve/extension build:firefox

Build output matches the submitted zip byte-for-byte.

- The extension only runs on x.com (host permission https://x.com/*).
- It talks to the project's own API at https://api.feedsieve.win via CORS;
  no host permission is requested for it.
- No remote code: all JavaScript ships in the package.
- AI-flavor check runs only after an explicit click, sends up to 20 public
  replies of one account to the project API, which forwards the text once to a
  third-party language-model service for scoring. Details are in PRIVACY.md.
- Scheduling and article editing are local; the extension never confirms or
  publishes on the user's behalf.
- This is the official listing published by the project author. The older
  FeedSieve 0.8.2 listing under another account is a third-party redistribution
  and is not maintained by the project.
```

## 截图

AMO 建议 1280×800。可复用 Chrome 商店截图，或从 `preview:popup` 出图后补。
当前不阻塞提交。
