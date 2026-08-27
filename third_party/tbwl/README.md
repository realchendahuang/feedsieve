# third_party/tbwl — Twitter-Block-With-Love (vendored)

- Upstream: https://github.com/E011011101001/Twitter-Block-With-Love
- License: MIT (see [LICENSE](LICENSE)) — copy, modification and redistribution permitted with attribution.
- Vendored: 2026-08-27, master `index.user.js` (single-file userscript, 894 lines).

## 为什么 vendor 它

TBWL 与 PureTwitter（闭源）互相独立地收敛到了同一个批量拉黑实现：
`POST /1.1/blocks/create.json`（X 网页端公开 client bearer + 会话 `ct0` CSRF）。
这是经生产验证的浏览器端拉黑标准路径，FeedSieve 的 Action Adapter 以此为基准
（见 `docs/research/PURETWITTER_MECHANISM.md` 与 `docs/X_ACTION_ADAPTER.md`）。

MIT 允许直接复用；本目录代码可作为 Phase 2/3 的参考实现直接搬运进
`packages/x-adapter/src/actions/` 做 TS 化改造。

## 值得直接搬的模式

- `ajax.post('/1.1/blocks/create.json', ...)`（block_user，L476 附近）
- 底部通知 `position:fixed` 挂 `#layers`（get_notifier_of）
- URL 轮询驱动页面模式切换（main() 的 setInterval URL diff —— 我们用 History API 替代）
- `waitForKeyElements` 等元素挂载（我们的 MutationObserver debounce 等价）
