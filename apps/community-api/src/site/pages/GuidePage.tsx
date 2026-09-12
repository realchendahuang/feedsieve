import { Link } from '@tanstack/react-router';
import { CHROME_STORE_URL, GITHUB_URL } from '../site';

/** 教程页：旧 /guide 内容逐段迁移；站内链接升级为真路由。 */
export default function GuidePage() {
  return (
    <main className="mx-auto max-w-3xl px-[clamp(18px,2.2vw,34px)] py-10 sm:py-12">
      <h1 className="text-3xl font-bold tracking-tight">使用教程</h1>
      <ul className="mt-4 flex flex-wrap gap-2 text-sm">
        {[
          ['安装', 'install'],
          ['上手四步', 'start'],
          ['打野排位', 'hunting'],
          ['设置', 'settings'],
          ['批量拉黑安全', 'safety'],
          ['常见问题', 'faq'],
        ].map(([label, id]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-mist underline-offset-4 transition-colors hover:text-ink hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ul>

      <h2 id="install" className="mt-10 scroll-mt-20 text-xl font-bold">安装</h2>
      <table className="mt-3 w-full text-sm" data-testid="guide-table">
        <tbody>
          <GuideRow label="Chrome 应用商店（推荐）">
            <ExtLink href={CHROME_STORE_URL}>点「添加至 Chrome」，自动更新</ExtLink>
          </GuideRow>
          <GuideRow label="GitHub Releases">
            <>
              <ExtLink href={`${GITHUB_URL}/releases`}>下载 ZIP 解压</ExtLink> →{' '}
              <code className="rounded bg-soft-surface px-1.5 py-0.5 text-xs">chrome://extensions</code>{' '}
              开发者模式 → 加载已解压的扩展程序
            </>
          </GuideRow>
          <GuideRow label="从源码构建">
            <>
              <code className="rounded bg-soft-surface px-1.5 py-0.5 text-xs">pnpm install &amp;&amp; pnpm build:extension</code>
              ，加载{' '}
              <code className="rounded bg-soft-surface px-1.5 py-0.5 text-xs">apps/extension/.output/chrome-mv3</code>
            </>
          </GuideRow>
        </tbody>
      </table>
      <p className="mt-3 text-sm text-mist">Edge / Brave 等 Chromium 浏览器可用后两种方式。装好即用，无需注册任何账号。</p>

      <h2 id="start" className="mt-10 scroll-mt-20 text-xl font-bold">上手四步</h2>
      <p className="mt-3 text-sm leading-relaxed">
        <strong>刷 X，看黄框。</strong>打开 x.com 正常滚动，高置信垃圾账号被黄框标出，下方一行显示判定理由，内容不隐藏。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>单个送走。</strong>黄框上点「顺手拉黑」：走你已登录 X 会话的内部 Block 接口，与手动点屏蔽同一条请求，手机端即刻同步消失。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>攒一批一起送走。</strong>黄标账号自动进待拉黑列表，点「一键拉黑 N 个」逐个执行；成功移除，失败如实保留并给出原因。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>漏网的自己补。</strong>任意推文操作栏点「标记垃圾并拉黑」，不需要理解检测规则。误伤了，已拉黑列表点「放回来」一键撤销。
      </p>

      <h2 id="hunting" className="mt-10 scroll-mt-20 text-xl font-bold">打野排位</h2>
      <p className="mt-3 text-sm leading-relaxed">
        弹窗「打野」tab：<strong>战报</strong>（击杀 / 命中率 / 称号）、<strong>榜单速览</strong>（Top 10 +
        你的排位）、完整<Link to="/lists/ranked" className="text-ink underline-offset-4 hover:underline">周榜公示</Link>。上榜默认匿名，想露脸需在弹窗认领档案并完成邮箱验证，可自愿绑定 @handle。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        计分：确认击杀 +1 · 首杀 +1 · 误伤 −2。按共识击杀计分，误拉黑不计分反而扣分。周赛季 ISO 周结算，Top 3 且命中率 ≥80% 获永久称号「猎黄人」。
      </p>

      <h2 id="settings" className="mt-10 scroll-mt-20 text-xl font-bold">设置</h2>
      <p className="mt-3 text-sm leading-relaxed">
        <strong>同步关注列表</strong>：把你的关注存为本地保护名单，自动排除在一切清理之外，永不上传。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>关键词规则</strong>：官方 8 个词库包共 778 条公开规则，默认只开「黄推 / 成人引流」，其余按需订阅；全文
        <Link to="/lists/keywords" className="text-ink underline-offset-4 hover:underline">公示在官网词库</Link>。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>识别强度</strong>：清爽 / 标准 / 大扫除 三档，只调证据用量；黄框标注在任何档位都永不自动批量拉黑。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>备份与迁移</strong>：导出 JSON 在新设备合并，不含任何 X 登录态。
      </p>

      <h2 id="safety" className="mt-10 scroll-mt-20 text-xl font-bold">批量拉黑的安全边界</h2>
      <p className="mt-3 text-sm leading-relaxed">
        拉黑走你的 X 登录会话，与手动点屏蔽是同一条请求。队列内置 <strong>400 条 / 24 小时</strong>滚动额度，用尽自动暂停（可选择继续）；连续
        429 触发风暴降级（暂停 + 预算砍半），认证失效当天额度清零。大名单请让它分几天跑完，不要指望一个晚上清零。
      </p>

      <h2 id="faq" className="mt-10 scroll-mt-20 text-xl font-bold">常见问题</h2>
      <p className="mt-3 text-sm leading-relaxed">
        <strong>为什么是拉黑，而不是隐藏？</strong>本地隐藏只骗过你这一个浏览器；X 原生 Block 全端生效，被拉黑的号再也无法回复 / @ / 关注你。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>需要 X 开发者 API 吗？</strong>不需要，拉黑全程在你已登录的 X 会话内完成，FeedSieve 服务器碰不到你的 X 账号。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>推文会被上传吗？</strong>不会，推文原文永不出设备；社区上报只含账号名、分类、话术指纹哈希与外链域名。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>被误标了怎么办？</strong>走
        <Link to="/lists/apply" className="text-ink underline-offset-4 hover:underline">官网申诉</Link>
        ，邮箱验证后进维护者复核队列。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <strong>换号还能被识别吗？</strong>能：话术指纹、外链域名、换号别名追踪，换号不换模板照样命中。
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        更细的口径与机制：工程文档见{' '}
        <ExtLink href={`${GITHUB_URL}/tree/main/docs`}>GitHub docs/</ExtLink>。
      </p>
    </main>
  );
}

function GuideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-line/50 align-top">
      <td className="py-2 font-semibold">{label}</td>
      <td className="py-2">{children}</td>
    </tr>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-ink underline-offset-4 hover:underline">
      {children}
    </a>
  );
}
