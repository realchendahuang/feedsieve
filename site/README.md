# site — 官网单页

静态站点，无构建步骤、无 JS。以 Cloudflare Workers 静态资产部署。

## 发布

```sh
cp wrangler.jsonc wrangler.local.jsonc   # 首次
# 在 wrangler.local.jsonc 填入 account_id 与自定义域 routes（此文件 gitignored，绝不提交）
npx wrangler deploy --config wrangler.local.jsonc
```

自定义域通过 `routes[].custom_domain` 声明，部署时自动建 DNS 与证书。

## 素材

页面与图片在 `site/public/`；头像与截图拷贝自 `assets/brand/` 与 `assets/store/`，源头更新后需重新拷贝再发布。只部署 `public/` 内的文件，配置与文档不会成为可下载资产。
