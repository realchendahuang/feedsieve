import { Link } from '@tanstack/react-router';
import { CHROME_STORE_URL, GITHUB_URL } from '../site';

/** 首页：品牌主视觉 + 安装入口 + 三支柱 + 公示入口；无营销段落（文案克制约定）。 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-16 pt-10 sm:pt-14">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          不信你看。
          <br />
          看不见就对了。
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          X（Twitter）赛博清洁工：高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href={CHROME_STORE_URL}
            className="inline-flex h-11 items-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Chrome 应用商店安装
          </a>
          <a
            href={GITHUB_URL}
            className="inline-flex h-11 items-center rounded-full bg-surface px-7 text-sm font-semibold text-ink shadow-[var(--panel-elev)] transition-colors hover:bg-wash-strong"
          >
            GitHub
          </a>
        </div>
        <figure className="mx-auto mt-10 max-w-3xl">
          <img
            src="/assets/screenshot-1-marked.png"
            alt="FeedSieve 在时间线上用黄框标注垃圾账号"
            className="w-full rounded-[calc(var(--radius)+10px)] shadow-[var(--panel-elev)]"
          />
        </figure>
      </section>

      <section className="mt-14 grid gap-4 sm:grid-cols-3">
        <Pillar title="黄框标注" text="只框不藏，判断理由可见" />
        <Pillar title="原生拉黑" text="X 服务器执行，全端生效" />
        <Pillar title="名单公开" text="开源仓库可审计" />
      </section>

      <section className="mt-14 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm font-semibold text-mist">
        <InLink to="/guide">使用教程</InLink>
        <InLink to="/lists/blacklist">名单公示</InLink>
        <ExtLink href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}>更新日志</ExtLink>
        <ExtLink href={`${GITHUB_URL}/blob/main/PRIVACY.md`}>隐私政策</ExtLink>
        <ExtLink href={`${GITHUB_URL}/blob/main/CONTRIBUTING.md`}>参与贡献</ExtLink>
        <ExtLink href={`${GITHUB_URL}/issues`}>反馈误标</ExtLink>
      </section>

      <section className="mt-14 text-center text-sm text-mist">
        判断在本地完成，推文原文不出设备。
      </section>
    </main>
  );
}

function Pillar({ title, text }: { title: string; text: string }) {
  return (
    <div className="panel-card p-6 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-mist">{text}</p>
    </div>
  );
}

function InLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="transition-colors hover:text-ink">
      {children}
    </Link>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-ink">
      {children}
    </a>
  );
}
