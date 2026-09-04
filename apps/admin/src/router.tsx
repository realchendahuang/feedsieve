import { createRoute, createRootRoute, createRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { Layout } from './components/layout';
import { AccountsPage } from './pages/AccountsPage';
import { DashboardPage } from './pages/DashboardPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { KeywordsPage } from './pages/KeywordsPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { SettingsPage } from './pages/SettingsPage';

// 搜索参数即页面状态：搜索词、编辑目标都能通过 URL 复现与分享。
// 全部字段 optional，parse 永不抛错。
const accountsSearch = z.object({
  q: z.string().optional(),
  edit: z.string().optional(),
});

const keywordsSearch = z.object({
  q: z.string().optional(),
  pack: z.string().optional(),
  editor: z.enum(['pack', 'rule']).optional(),
  edit_pack: z.string().optional(),
  edit_rule: z.string().optional(),
});

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });
const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'accounts',
  validateSearch: (search) => accountsSearch.parse(search),
  component: AccountsPage,
});
const keywordsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'keywords',
  validateSearch: (search) => keywordsSearch.parse(search),
  component: KeywordsPage,
});
const feedbackRoute = createRoute({ getParentRoute: () => rootRoute, path: 'feedback', component: FeedbackPage });
const releasesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'releases', component: ReleasesPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([indexRoute, accountsRoute, keywordsRoute, feedbackRoute, releasesRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
