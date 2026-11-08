# Firefox 支持

Firefox 版与 Chrome 版共用同一套代码，构建目标为 MV3。当前状态：**Chrome / Firefox 双端均已上架**；官方 AMO 条目 [FeedSieve 福滤娃](https://addons.mozilla.org/zh-CN/firefox/addon/feedsieve-fuluwa/) 的 0.15.0 已通过审核并公开（2026-11-05 前后），0.18.0 已于 2026-11-08 提交审核（含 AMO 审核用源码包）。

> **AMO 上的 `feedsieve` 条目不是本项目发布的。** 2026-09-07，AMO 账号「AI小鲸鱼」在注册 19 分钟后用 `feedsieve@feedsieve.local` 上架了 0.8.2；该 ID 和条目属于对方，不能复用。`feedsieve@feedsieve.win` 也被对方占成了非公开条目（上传时报重复 ID），官方改用 `feedsieve-official@feedsieve.win` 另建条目；不举报对方，靠官方条目、README 和审核说明区分。详见下方「AMO 上架」。

## 构建

```sh
pnpm --filter @feedsieve/extension build:firefox
pnpm check:extension:firefox
```

产物在 `apps/extension/.output/firefox-mv3/`。校验脚本会检查 MV3、Gecko ID、权限、`sidebar_action`、`background.scripts`、MAIN world 网络桥和入口文件。

发版打包（含 `web-ext lint`、zip 审计和 AMO 审核用完整源码包）：

```sh
sh scripts/pack-firefox.sh
```

产出 `feedsieve-<version>-firefox.zip`、`feedsieve-<version>-firefox-source.zip` 及各自 `.sha256`。源码包只含 `apps/extension`、`packages/*`、`community/*` 和根配置；已验证从源码包 `pnpm install --frozen-lockfile` 后构建出的产物与提交 zip 完全一致。

## 本机调试

### 方式一：about:debugging（推荐）

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点「临时加载附加组件」，选择 `apps/extension/.output/firefox-mv3/manifest.json`
3. 侧边栏会出现 FeedSieve；工具栏弹窗在扩展菜单里
4. 改代码后重新 build，在 about:debugging 里点「重载」

### 方式二：web-ext

```sh
npx web-ext run --source-dir apps/extension/.output/firefox-mv3
```

`web-ext run` 会用临时 profile 启动 Firefox 并自动加载扩展；关闭终端后临时扩展消失。

## 与 Chrome 版的差异

| 项           | Chrome                                 | Firefox                                                                         |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| 侧边栏       | `side_panel` + `sidePanel` 权限        | `sidebar_action` + 同一个 `popup.html`                                          |
| 后台         | service worker                         | `background.scripts`（事件页，空闲会停）                                        |
| 权限         | storage / unlimitedStorage / sidePanel | storage / unlimitedStorage                                                      |
| Gecko ID     | —                                      | `feedsieve-official@feedsieve.win`（官方 ID；`.local` / `.win` 都被第三方占用） |
| 最低版本     | —                                      | Firefox 140；暂不声明 Android（侧边栏 / 弹窗未验收）                            |
| 数据传输声明 | 商店隐私权表单                         | `browser_specific_settings.gecko.data_collection_permissions`                   |

`getChromeSidePanel()` 在 Firefox 下用 `browser.sidebarAction` 模拟 `open` / `close`，调用方无需分支。两者都要求用户手势，从 content script 转发点击时可能失败，界面按「侧边栏打开失败」提示。

## AMO 上架

### 先处理第三方转载条目

AMO 上的 <https://addons.mozilla.org/zh-CN/firefox/addon/feedsieve/>（0.8.2，GUID `feedsieve@feedsieve.local`）不是本项目发布：

- 账号「AI小鲸鱼」创建于 2026-09-07T20:33Z，19 分钟后（20:52Z）就上架了 FeedSieve 0.8.2
- 同一账号还发布了 `xclipper-firefox@example.com`（X/Twitter Web Clipper），同样是占位 GUID
- 该包的 manifest 没有 author / homepage，support 链接却指向本项目的 GitHub Issues；数据收集声明为 `none`，也没有许可证和隐私政策
- 包内只有旧 API 域名 `feedsieve-api.chendahuang.com`（已失效），没有任何新域名；代码看起来是旧版原样转载，但更新权在对方手里，不能引导用户安装

处理方式（2026-11-02 确认不举报）：

1. 对方条目继续留在 AMO，我们不更新它，也不把官方 ID 改成 `.local`
2. `feedsieve@feedsieve.win` 也被对方占成了非公开条目——上传 0.13.1 时报「发现重复的附加组件 ID」
3. 官方改用 `feedsieve-official@feedsieve.win` 另建条目；标题用「FeedSieve 福滤娃」，名称冲突时再加「（官方）」
4. README 和 listing 里说明 AMO 上已有的 0.8.2 条目不是官方发布，避免用户装错

### 官方版提交

上架文案、字段、数据收集勾选和审核员说明见 [`AMO-LISTING.md`](AMO-LISTING.md)。

提交记录：2026-11-02 提交 0.13.2；0.15.0 通过审核上线；2026-11-08 提交 0.18.0（附源码包，等待审核）。条目 <https://addons.mozilla.org/zh-CN/firefox/addon/feedsieve-fuluwa/>，审核通过后 AMO 自动发布，已装 0.8.2 的第三方条目用户不会自动迁移到官方条目。

发版前：

1. 用登录了 X 的 Firefox 完成下方「尚未验证」清单
2. `pnpm check:extension:firefox` 通过
3. `npx web-ext lint --source-dir apps/extension/.output/firefox-mv3`，要求 0 errors
4. 更新 `PRIVACY.md`、本文件和 `CHANGELOG.md`；确认 `data_collection_permissions` 与隐私政策逐项对应

提交时：

1. 在 [AMO 开发者中心](https://addons.mozilla.org/developers/) 新建条目（官方 ID `feedsieve-official@feedsieve.win`），上传 Firefox zip
2. 附完整 monorepo 源码 zip（WXT 默认 sources.zip 只含扩展子目录，不含 `packages/*`）和构建说明
3. 审核说明里写清：AI 味检测会把公开回复交给第三方语言模型判定一次；无远程代码；`browser.storage` 与 `x.com` 主机权限的用途；并说明官方发布与转载条目的区别
4. listing：MIT 许可证、隐私政策 URL、主页 `https://feedsieve.win/`、截图、当前功能描述；数据收集选网站内容 / 用户活动 / 唯一标识 / 认证信息四类
5. 只勾桌面 Firefox；Android 等真机验收后再开

审核通过后 AMO 自动发布。

## 已验证 / 未验证

已在 macOS + Firefox 159 验证：

- 临时加载、扩展 ID 识别
- 侧边栏渲染，热帖 / 主页 / 发帖 / AI 味 / 清理 / 设置六个视图切换
- background 事件页按需唤醒（about:debugging 显示「运行中」）
- `check-firefox.mjs` 全项通过
- `web-ext lint`：0 errors，6 个 warning 全部是 React DOM 的 `innerHTML` 实现

尚未验证（需要真实 X 登录态）：

- x.com 上的内容脚本标注、MAIN world 网络桥
- 拉黑 / 撤销、关注保护、名单上传开关
- Firefox for Android
