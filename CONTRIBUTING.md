# Contributing to FeedSieve

欢迎提交 PR、Issue、垃圾样本、规则建议，以及任何你在 X 上见过的离谱话术。

## 环境搭建（克隆后一次性）

```sh
pnpm install
git config core.hooksPath .githooks   # 启用 pre-push 本地质量门禁
```

push 前会自动跑 lint / typecheck / test / build（即 `pnpm verify`）。本项目不用 GitHub Actions，所有检查在本地完成。

## 最有价值的贡献

- X DOM 兼容性修复
- 垃圾模式样本
- 高精度本地规则
- 性能优化
- 隐私设计
- Filter Pack
- UI / UX
- 更好笑但不影响理解的中文文案

## 原则

1. 默认保护用户隐私。
2. 能本地完成的判断优先本地完成。
3. 不把“观点不同”当成垃圾。
4. 所有自动过滤都应该允许用户恢复。
5. 不做隐蔽的数据收集。
