---
name: feedsieve-article
description: 用 FeedSieve（福滤娃）把 Markdown 排版成 X 文章（Draft.js 编辑器）并插入本地图片。外部 AI Agent 在 ego-browser 里打开 X 文章编辑器、粘贴 Markdown 自动转换、按占位符插入本地图片、校验后把草稿留给用户发布。当用户说「把这篇文章排到 X」「用福滤娃排版」「X 文章 Markdown」「把 md 变成 X 长文」「自动发文章」时使用。
metadata:
  version: "1.0.0"
  date: "2026-11-06"
---

# feedsieve-article

把 Markdown 变成 X 文章（X Articles，需要 Premium 账号）的排版流程。两条路径：

- **A（推荐）**：浏览器里装了 FeedSieve 扩展 → 直接粘 Markdown，扩展自动排版 + 插图；
- **B（兜底）**：没有扩展但能跑 Node → 用仓库里的转换 CLI 出 HTML，再用浏览器粘贴。

**红线：只做草稿和校验，不替用户点「发布」。** 用户明确说「发出去」之前，发布按钮不碰。

## 坐标（2026-11-06 实测，X 改版后要重新核对）

| 项 | 值 |
| --- | --- |
| 文章列表 | `https://x.com/compose/articles`（「撰写」按钮新建） |
| 编辑页 | `https://x.com/compose/articles/edit/<id>` |
| 正文编辑器 | `[data-testid="composer"]`（Draft.js，`contenteditable="true"`） |
| 标题框 | `textarea[name="文章标题"]` |
| 图片上传入口（封面） | `input[data-testid="fileInput"][accept="image/jpeg,image/png,image/webp"]` |
| 正文图片入口 | 「插入 › 媒体」点开后才出现，accept 里带 `video/mp4` |
| FeedSieve 面板 | `#feedsieve-article-panel`，插图按钮在 `.fs-ap-image-row button` |
| 扩展 ID（开发版） | `ikaddnpcjdcliaijmnheoljedinllefe`（商店版 `amhdjglnonjaoenddnifpnljgmocfdph`） |

## 流程 A：扩展已装（推荐）

前置：ego-browser 可用、浏览器已登录 X、当前账号能开 Articles。

1. **打开编辑器**：已有草稿就 `page.goto("https://x.com/compose/articles/edit/<id>")`；新建就打开列表页点 `[data-testid="empty_state_button_text"]`（文案是「撰写」），拿到新 URL。
2. **聚焦正文**：`page.mouse.click` 到编辑器中部空白处，等 300ms。
3. **粘贴 Markdown**（必须走原生粘贴，扩展才拦得住）：

   ```js
   await page.keyboard.paste({ text: markdown });
   ```

   扩展会拦下这次粘贴、转成 X 认的 HTML，并自动填标题（标题框为空时）。
4. **等 1.2s 再校验**：粘贴后 300ms 内不要把焦点移到标题框（Draft 会覆盖），让扩展先填完标题。
   校验：`[data-testid="composer"] [data-block="true"]` 里出现正文；标题框有值；页面里没有再出现原始 `#` / `**` 语法。
5. **插本地图片**（Markdown 里是 `images/foo.png` 这类相对路径时）：

   - 扩展会把它们转成「🖼 图片 N：路径」占位段，右下角面板出现「插入图片（N）」；
   - 点面板按钮，用 ego 的文件选择器喂文件：

     ```js
     const btn = await page.evaluate(() => { const b = document.querySelector('#feedsieve-article-panel .fs-ap-image-row button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
     const chooserPromise = page.waitForFileChooser({ timeout: 10000 });
     await page.mouse.click(btn.x, btn.y);
     const chooser = await chooserPromise;
     await chooser.setFiles(['/abs/path/images/foo.png']);  // 一次一张
     ```

   - 等 8–15s 让 X 上传完；面板上的数字减 1、正文里出现图片块（`SECTION`）即成功；
   - 还有剩余就再点一次按钮，**一次只插一张**（Draft 连续插入会丢图/并段）。
   - 文件名和占位符里的文件名对不上时按顺序补位；插错可 ⌘Z 撤销。
6. **校验**：正文里搜不到 `🖼`；图片块数量 = Markdown 里的本地图数量；标题、小标题、列表、引用都在。
   给用户截一张图（`page.screenshot({ path })`）确认排版。
7. **收尾**：X 会自动存草稿；不要点「发布」。测试产生的草稿要删：列表页草稿行「更多」→「删除文章」→「是的，删除」。

## 流程 B：没有扩展（纯 HTML）

能跑 Node（≥22）时，在 FeedSieve 仓库里：

```bash
node scripts/article-format.mjs article.md            # JSON：title / html / text / images
node scripts/article-format.mjs article.md --html     # 只打印 X 编辑器认的 HTML
node scripts/article-format.mjs article.md --out /tmp/article.json
```

然后把 HTML 交给浏览器粘贴（扩展没装时 X 自己也能吃这套 HTML）：

```js
await page.keyboard.paste({ text: result.text, html: result.html });
```

标题在 X 里要单独填（`textarea[name="文章标题"]`，原生 setter + input 事件）；本地图片这条路只能保留占位符，需要人工插图，**提前告诉用户**。

## Markdown 支持范围（转换器保证的）

标题 `#`→文章标题、`##`→标题、`###`→副标题、`####` 以下→加粗段落；列表拍平；引用；代码块→引用保缩进；
表格→逐行「| 」段落；分隔线→「———」；加粗/斜体/删除线/链接/行内代码；相对路径图片与 Obsidian `![[图片.png]]`→占位符。

## 坑（都踩过）

- 粘贴必须 `isTrusted`：用 `page.keyboard.paste()` 或系统剪贴板，**不要**在 `page.evaluate` 里派发 `ClipboardEvent` 当普通粘贴（扩展的拦截要求原生事件）。
- 标题填完后把焦点还给正文；否则 X 的受控输入可能丢内容。
- 图片路径按 **Markdown 文件所在目录** 解析，Agent 选文件时用绝对路径。
- 网络图片（`https://…`）在 X 文章里只能变成链接，插不了图；要图就本地化后走占位符。
- 一次只插一张，插完等图片块出现再点下一次。
- 编辑器是 Draft.js，别用 `innerText` 直接写内容；只走粘贴。
- 不点「发布」；不点「删除草稿」除非用户同意。

## 自检清单

- [ ] 标题填了，正文没有残留 `#`、`**`、`![]()`
- [ ] 小标题/列表/引用/代码块和原 Markdown 对得上
- [ ] 本地图片都变成图片块、没有 `🖼` 占位符
- [ ] 页面截图给用户看过
- [ ] 停留在草稿，未发布
