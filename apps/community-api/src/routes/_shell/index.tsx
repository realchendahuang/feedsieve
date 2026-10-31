import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/site/seo';
import HomePage from '@/site/pages/HomePage';
import { getWeeklyPicks } from '@/site/data.functions';

export const Route = createFileRoute('/_shell/')({
  // 周刊热帖拿不到时为 null，首页不显示该模块
  loader: () => getWeeklyPicks(),
  head: () =>
    pageHead({
      title: '用了福滤娃，评论区不骚了，好帖也不漏了',
      description:
        '开源的中文 X（Twitter）刷推副驾驶：黄推一眼标出、一键原生拉黑；帖子流速与作者量级、热帖榜、博主主页爆款分析，只读页面已经加载的数据。',
      path: '/',
    }),
  component: HomePage,
});
