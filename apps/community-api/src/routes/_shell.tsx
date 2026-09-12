import { Outlet, createFileRoute } from '@tanstack/react-router';
import { SiteHeader } from '@/site/components/SiteHeader';

/**
 * 全站统一布局壳：SiteHeader 只在这里渲染一次，所有带页头的页面经 _shell/ 挂载。
 * 顶栏之外的路由不进这个壳：OG 图片、未匹配路径的 404 兜底（在 __root）。
 */
export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <>
      <SiteHeader withApply />
      <Outlet />
    </>
  );
}
