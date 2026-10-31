# Firefox 支持

Firefox 版与 Chrome 版共用同一套代码，构建目标为 MV3。当前状态：**可构建、可临时加载、界面已验证；真实 X 账号上的标注与拉黑尚未验收**。

## 构建

```sh
pnpm --filter @feedsieve/extension build:firefox
pnpm check:extension:firefox
```

产物在 `apps/extension/.output/firefox-mv3/`。校验脚本会检查 MV3、Gecko ID、权限、`sidebar_action`、`background.scripts`、MAIN world 网络桥和入口文件。

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

| 项 | Chrome | Firefox |
| --- | --- | --- |
| 侧边栏 | `side_panel` + `sidePanel` 权限 | `sidebar_action` + 同一个 `popup.html` |
| 后台 | service worker | `background.scripts`（事件页，空闲会停） |
| 权限 | storage / unlimitedStorage / sidePanel | storage / unlimitedStorage |
| Gecko ID | — | `feedsieve@feedsieve.win`（AMO 首次提交后不可改） |
| 最低版本 | — | Firefox 140；Android 142 |
| 数据传输声明 | 商店隐私权表单 | `browser_specific_settings.gecko.data_collection_permissions` |

`getChromeSidePanel()` 在 Firefox 下用 `browser.sidebarAction` 模拟 `open` / `close`，调用方无需分支。两者都要求用户手势，从 content script 转发点击时可能失败，界面按「侧边栏打开失败」提示。

## AMO 上架

1. `pnpm check:extension:firefox` 通过
2. `npx web-ext lint --source-dir apps/extension/.output/firefox-mv3`，要求 0 errors
3. 在 [AMO 开发者中心](https://addons.mozilla.org/developers/) 提交 zip 和完整源码
4. 首次提交前确认：
   - Gecko ID 是否已有条目；没有就用 `feedsieve@feedsieve.win`
   - `data_collection_permissions` 与 `PRIVACY.md` 的条目逐项对应
   - 源码提交需要完整 monorepo（WXT 默认 sources.zip 只含扩展子目录）

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
