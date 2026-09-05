import { createRoute, createRootRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './components/layout';
import { AccountsPage } from './pages/AccountsPage';
import { DashboardPage } from './pages/DashboardPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { KeywordsPage } from './pages/KeywordsPage';
import { ReleasesPage } from './pages/ReleasesPage';
import { SettingsPage } from './pages/SettingsPage';

// 编辑/新增状态都在 Dialog 本地组件态里，不再写进 URL；路由只负责页面切换。
const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });
const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'accounts', component: AccountsPage });
const keywordsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'keywords', component: KeywordsPage });
const feedbackRoute = createRoute({ getParentRoute: () => rootRoute, path: 'feedback', component: FeedbackPage });
const releasesRoute = createRoute({ getParentRoute: () => rootRoute, path: 'releases', component: ReleasesPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: 'settings', component: SettingsPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  accountsRoute,
  keywordsRoute,
  feedbackRoute,
  releasesRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
