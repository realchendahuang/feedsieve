# Firefox 支持与 AMO 发布

## 构建与临时安装

使用 Node.js 22（或更新版本）和根 `package.json` 指定的 pnpm 11.11.0，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build:extension:firefox
pnpm check:extension:firefox
pnpm zip:extension:firefox
```

构建目录为 `apps/extension/.output/firefox-mv3`，扩展包为
`apps/extension/.output/feedsieve-<version>-firefox.zip`。
开发时可运行 `pnpm --filter @feedsieve/extension dev:firefox`。
Chrome 原有构建与发布命令保持不变。

在 Firefox 桌面版 140+ 打开 `about:debugging#/runtime/this-firefox`，选择
「临时载入附加组件」，打开构建目录内的 `manifest.json`。重启浏览器会移除临时扩展。
普通用户的持久安装需要 Mozilla 签名；不要将未签名 ZIP 描述为已上架的安装包。

官方教程：[临时安装](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)、
[运行扩展](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)。

## 兼容性选择

- 明确使用 Manifest V3，避免 WXT 的 Firefox 默认 MV2 路径。
- WXT 为 Firefox 生成 `background.scripts`；Chrome 继续使用 service worker。
- `feedsieve@chendahuang.com` 是拟用于首次 AMO 提交的稳定扩展 ID。维护者需在首次提交前确认；
  如果已有 AMO 条目，应改用其 ID。已发布后不要更换 ID，否则会影响升级与本地数据关联。
- MAIN world 网络桥沿用现有 JSON 字符串 CustomEvent 协议；Firefox 128 起支持声明式 MAIN world。
- 桌面最低版本为 140、Android 最低版本为 142，以使用 Mozilla 内置数据传输授权。
  Android 的最低版本声明不代表已完成移动端 UI 或实际设备测试；首次发布只选择已测试的平台。

依据：[WXT 多浏览器构建](https://wxt.dev/guide/essentials/target-different-browsers.html)、
[Mozilla Firefox 128 MAIN world 支持](https://blog.mozilla.org/addons/2024/07/10/manifest-v3-updates-landed-in-firefox-128/)、
[扩展 ID 与浏览器设置](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)。

## 数据传输声明

Firefox 安装时要求用户接受以下数据类别，覆盖当前版本已有的传输行为：

| 类别 | 对应功能 |
| --- | --- |
| `websiteContent` | 社区标签中的账号、规则证据、指纹、外链域名，以及 X 请求内容 |
| `websiteActivity` | 用户明确维护的拉黑、白名单与抢救判断 |
| `personallyIdentifyingInfo` | 猎手档案中用户填写的邮箱、显示名、简介与安装身份关联 |
| `authenticationInfo` | 邮箱验证、安装身份及向 X 自身发送的会话认证请求 |

这些类别作为安装授权声明；应用内原有的名单上传开关与显式档案操作仍有效。
版本号随业务请求发送用于协议诊断，当前没有新增遥测或分析上报。
不能声明 `required: ["none"]`，因为现有代码会向官方社区 API 发送数据。
维护者发布前应结合实际服务器行为复核 [隐私政策](../PRIVACY.md)，并在 AMO 填写相同范围。
如果以后把某项数据改为 Firefox 的 `optional` 权限，必须同时在代码中请求权限并在撤销后阻止对应发送，不能只改 manifest。

官方依据：[Firefox 内置数据传输授权](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)、
[数据授权最佳实践](https://extensionworkshop.com/documentation/develop/best-practices-for-collecting-user-data-consents/)。

## 验证

```sh
pnpm verify
pnpm dlx web-ext lint --source-dir apps/extension/.output/firefox-mv3
```

`pnpm verify` 与 GitHub Actions 均构建 Chrome 和 Firefox，并检查 Firefox 清单中的版本、ID、
数据声明、后台脚本、页面网络桥、生产域名范围与入口文件。
`web-ext lint` 是 Mozilla 官方包校验工具；通过校验并不等同于通过 AMO 人工审核。
初次适配校验没有错误，React DOM 打包代码中的 `dangerouslySetInnerHTML` 实现有两条
`UNSAFE_VAR_ASSIGNMENT` 告警；扩展源码没有使用该 React 属性。源码审核备注应说明依赖来源，
不要修改第三方打包代码或隐藏校验告警。构建还保留原有的大 chunk 体积提示。

在独立 Firefox 配置中至少验证：

1. 临时安装后弹窗正常显示，设置写入后重开弹窗仍保留。
2. 在 X 页面确认 fetch 和 XHR 时间线响应都经 MAIN world 桥传入扩展，无跨 world 权限异常。
3. 确认黄框标注、名单与关键词设置、页面消息通信和队列显示。
4. 使用维护者自己的测试账号验证单次拉黑、撤销及关注保护；核对 X 服务端结果。
5. 对新安装查看数据与站点授权；关闭名单上传后检查不再发送名单。

自动化页面 fixture 不替代登录 X 后的真实账号验收，也不验证 AMO 安装提示或升级签名。

## 维护者上架步骤

1. 合并适配 PR，确认最终 ID、发布版本及隐私政策，并完成上述账号验收。
2. 在同一提交上执行 `pnpm install --frozen-lockfile`、`pnpm verify` 和 `pnpm zip:extension:firefox`。
3. 为审核提供完整 monorepo 源码，而非只有 `apps/extension`。在已提交且干净的工作树运行：

   ```sh
   git archive --format=zip --output=apps/extension/.output/feedsieve-source.zip HEAD
   ```

   WXT 自动生成的 `feedsieve-<version>-sources.zip` 只包含扩展子目录，不足以重建此 monorepo，不能代替上述完整源码包。
   完整源码包包含 workspace packages、锁文件及构建配置。使用本页命令即可重建；
   不需要 API 密钥、Cloudflare 登录、签名私钥或本地 `.env`。
4. 登录 [AMO 开发者中心](https://addons.mozilla.org/developers/)，选择提交新附加组件及
   “On this site” 分发，上传 `feedsieve-<version>-firefox.zip`。
5. 声明需要源码审核，另上传完整 `feedsieve-source.zip`，提供本页构建命令与运行环境。
6. 填写名称、中文介绍、图标、截图、MIT 许可证、支持地址及隐私政策；选择已实际测试的平台。
   审核备注解释 MAIN world 桥仅解析既有时间线响应，以及真实拉黑仅由用户触发。
7. 处理校验或审核意见，提交审核。签名并公开后，把真实 AMO 链接加入 README 与官网；
   后续使用同一 ID 并提高扩展版本更新。

官方教程：[提交附加组件](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)、
[源码提交要求](https://extensionworkshop.com/documentation/publish/source-code-submission/)、
[签名与分发](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)。

AMO 账号、发布者身份、提交审核与市场上架由项目维护者完成；本仓库的构建产物和 PR 不代表已发布。
