# site — 官网单页

静态站点，无构建步骤、无 JS。

## 发布

Cloudflare Pages 直传，项目 `feedsieve-site`，生产分支 `main`：

```sh
npx wrangler pages deploy site --project-name feedsieve-site --branch main
```

自定义域在 Cloudflare 侧绑定，路由配置不入仓库（开源公私分明）。

## 素材

`site/assets/` 下的头像与截图拷贝自 `assets/brand/` 与 `assets/store/`；源头更新后需重新拷贝再发布。
