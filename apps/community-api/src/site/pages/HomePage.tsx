import { Link } from '@tanstack/react-router';
import {
  Zap,
  Sparkles,
  Lock,
  ChevronDown,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Flame,
  Shield,
  Filter,
  TrendingUp,
  Search,
  CalendarDays,
  Bot,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { CHROME_STORE_URL, GITHUB_URL } from '../site';
import { WeeklyPicks } from './WeeklyPicks';

function GithubIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

/**
 * 首页：品牌主视觉 + 浏览器演示视窗 + 信任指标 + 「看得准 · 挖得深」截图区 +
 * 「清干净」Bento + 两张对比表 + FAQ + 底栏 CTA。
 * 定位：中文 X 刷推副驾驶（清干净 / 看得准 / 挖得深），见 docs/08。
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-[clamp(18px,2.2vw,34px)] pb-20 pt-8 sm:pt-14">
      {/* 1. HERO 头部 */}
      <section className="text-center">
        {/* 顶部胶囊标签 */}
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-surface px-4 py-1.5 text-xs font-semibold text-gold shadow-sm">
          <Sparkles className="size-3.5 animate-pulse" />
          <span>清评论 · 看热帖 · 挖博主 · 排发帖 · 辨 AI 味</span>
        </div>

        {/* 标语主标题 */}
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-6xl text-ink leading-[1.15]">
          用了福滤娃，
          <br />
          <span className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 dark:from-amber-400 dark:via-amber-500 dark:to-amber-600 bg-clip-text text-transparent">
            评论区不骚了，好帖也不漏了。
          </span>
        </h1>

        {/* 副标题 */}
        <p className="mx-auto mt-5 max-w-2xl text-base text-mist sm:text-lg leading-relaxed">
          开源的中文 X（Twitter）副驾驶：清评论、看热帖、挖博主、排发帖、辨 AI
          味——一个装全，本地优先，不拿账号冒险。
        </p>

        {/* 核心行动按钮 */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-bold text-primary-foreground shadow-lg shadow-black/5 transition-all hover:scale-[1.02] hover:opacity-95 active:scale-98"
          >
            <span>Chrome 商店一键安装</span>
            <ArrowRight className="size-4" />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-surface px-7 text-sm font-semibold text-ink shadow-[var(--panel-elev)] border border-line/70 transition-all hover:bg-wash-strong active:scale-98"
          >
            <GithubIcon className="size-4 text-ink" />
            <span>GitHub 开源仓库</span>
          </a>
          <Link
            to="/guide"
            className="inline-flex h-12 items-center rounded-full px-5 text-sm font-semibold text-mist hover:text-ink transition-colors"
          >
            上手教程 →
          </Link>
        </div>

        {/* 2. 拟真视窗演示区 */}
        <div className="relative mx-auto mt-12 max-w-4xl glow-gold">
          <div className="window-frame overflow-hidden">
            {/* 模拟浏览器标题栏 */}
            <div className="flex h-10 items-center justify-between border-b border-line/60 bg-soft-surface/90 px-4 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <span className="size-3 rounded-full bg-[#ff5f56]" />
                <span className="size-3 rounded-full bg-[#ffbd2e]" />
                <span className="size-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="flex items-center gap-2 rounded-full border border-line/70 bg-surface px-3 py-1 text-xs text-mist">
                <Lock className="size-3 text-gold" />
                <span className="font-mono">扩展面板 / 主页洞察</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="hidden sm:inline">福滤娃正在保护</span>
              </div>
            </div>

            {/* 产品界面：博主主页洞察 */}
            <div className="relative bg-paper/50 py-4">
              <img
                src="/assets/screens/profile.png"
                alt="福滤娃面板：博主主页洞察，中位浏览、爆款率、内容形式与发帖时段"
                className="mx-auto block max-h-[520px] w-auto max-w-full object-contain"
              />
            </div>
          </div>

          {/* 视窗下方的悬浮标签 */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 text-xs">
            <span className="pill-badge text-ink">
              <span className="text-gold font-bold">🧹</span> 黄推标出 · 原生拉黑全端同步
            </span>
            <span className="pill-badge text-ink">
              <span className="text-gold font-bold">🔥</span> 每条帖子的流速 · 热帖榜
            </span>
            <span className="pill-badge text-ink">
              <span className="text-gold font-bold">🔍</span> 博主爆款倍数 · 内容与时段规律
            </span>
            <span className="pill-badge text-ink">
              <span className="text-gold font-bold">🗓</span> 发帖时间表 · 下一个空档
            </span>
            <span className="pill-badge text-ink">
              <span className="text-gold font-bold">🤖</span> AI 味检测 · 多人复核
            </span>
          </div>
        </div>
      </section>

      {/* 3. 核心指标信任条 */}
      <section className="mt-16 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          number="3,144+"
          label="社区黑名单"
          desc="全量明牌公示，日日滚动更新"
          link="/lists/blacklist"
        />
        <StatCard
          number="778 条"
          label="开源精炼词库"
          desc="8 大分类规则包，纯本地沙箱匹配"
          link="/lists/keywords"
        />
        <StatCard
          number="400 发"
          label="防封安全配额"
          desc="24h 智能时间抖动，遇 429 自动装死熔断"
          link="/guide#safety"
        />
        <StatCard
          number="0 次"
          label="额外请求 X"
          desc="热帖和主页洞察只读页面已经加载的数据，不替你滚动"
          link="/guide#faq"
        />
      </section>

      {/* 3.5 福滤娃周刊：本周 X 精选（周刊 Worker 经 service binding 提供，拿不到时不渲染） */}
      <WeeklyPicks />

      {/* 3.6 看得准 · 挖得深：热帖与博主主页 */}
      <section className="mt-20">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
            <TrendingUp className="size-4 text-gold" />
            <span>看得准 · 挖得深</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            哪条正在火、谁的哪条最好，一眼看清
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-mist">
            点开扩展或挂在侧边栏，跟着你的浏览自动更新。
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <ShowcaseCard
            icon={<Flame className="size-5" />}
            kicker="热帖"
            title="刷过的火帖，一个不漏"
            points={[
              '推文右上角显示每小时浏览数，正在火的变红；作者名旁显示量级',
              '汇总你最近 2 小时在所有 X 标签页刷到的火帖，按热度、回复机会、粉丝、收藏、最近刷到排序',
              '「全站」汇总所有福滤娃用户刷到的火帖，至少 3 人看到才上榜',
            ]}
          />
          <ShowcaseCard
            icon={<Search className="size-5" />}
            kicker="主页洞察"
            title="打开任意博主主页，看他的爆款"
            image="/assets/screens/profile.png"
            alt="侧边栏「主页」：博主的中位浏览、爆款率、内容形式与发帖时段"
            points={[
              '每条帖子是他自己中位浏览的几倍，3 倍以上标金色',
              '纯文字、图片、视频、引用各自的表现，哪个时段发帖效果最好',
              '一键在 X 搜他的高赞帖、Google 站内搜索、复制 Top 20 给 AI、导出 CSV',
            ]}
          />
          <ShowcaseCard
            icon={<CalendarDays className="size-5" />}
            kicker="发帖"
            title="时间表、下一个空档、草稿与文章"
            points={[
              '设每天固定时间点或间隔，发帖框里按 Alt+N 直接填下一个空档',
              '面板里写草稿、排序，点日历贴进 X 发帖框；最后一下仍由你点',
              'X 文章编辑器直接粘 Markdown 自动排版，带字数、大纲和本机备份',
            ]}
          />
          <ShowcaseCard
            icon={<Bot className="size-5" />}
            kicker="AI 味"
            title="这条回复是不是 AI 写的"
            points={[
              '读账号最近 6–20 条公开回复，给 AI 味百分比、档位和一句锐评',
              '一个人测出的结论只给本人看，多人测到重合才公开',
              '够票才进社区 AI 号名单；评论区标记可折叠或关闭',
            ]}
          />
        </div>
      </section>

      {/* 4. 清干净 BENTO GRID */}
      <section className="mt-20">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
            <Filter className="size-4 text-gold" />
            <span>清干净</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            只框不藏，拉黑交给你
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-mist">
            评论区的黄推和引流号：黄框标出、写明理由，你点了才拉黑。
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Bento 1: 只框不藏（跨 2 列） */}
          <div className="panel-card p-6 md:col-span-2 lg:col-span-2 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-gold">
                <Filter className="size-5" />
                <span className="text-xs font-bold uppercase tracking-wider">证据明牌</span>
              </div>
              <h3 className="mt-2 text-xl font-bold text-ink">
                只框不藏：推文原汁原味展示，判断权永远归你
              </h3>
              <p className="mt-2 text-sm text-mist leading-relaxed">
                不搞暗箱操作，绝不搞盲盒式直接吞掉推文。高置信垃圾账号被醒目黄框圈出，明牌贴出识别原因（机器人水军、色情引流、套路模板、外链欺诈）。你可以亲眼看到它到底说了什么，再决定一键送走还是放它一马。
              </p>
            </div>

            {/* 模拟推文黄框卡片 */}
            <div className="mt-5 rounded-xl border-2 border-gold/80 bg-gold-surface/30 p-4 dark:bg-gold-surface/10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-mist/20 flex items-center justify-center font-bold text-xs">
                    媚
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                      <span>娇妻媚儿（私信看主页）</span>
                      <span className="rounded bg-gold/20 px-1.5 py-0.2 text-[10px] text-gold-deep font-semibold">
                        黄推特征命中
                      </span>
                    </div>
                    <div className="text-[11px] text-fog">@jiaoqi_meir888 · 刚刚</div>
                  </div>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  顺手拉黑
                </div>
              </div>
              <p className="mt-2.5 text-xs text-ink/90 leading-relaxed font-sans">
                那一夜你没有拒绝我，我以为这就是爱情……点我置顶链接看更多私密小视频 🔞👇
              </p>
              <div className="mt-2 text-[11px] font-medium text-gold-deep">
                ⚠️ 判定依据：匹配成人引流话术库 · 含外部跳转短链
              </div>
            </div>
          </div>

          {/* Bento 2: 原生 Block */}
          <div className="panel-card p-6 md:col-span-2 lg:col-span-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-gold">
                <Zap className="size-5" />
                <span className="text-xs font-bold uppercase tracking-wider">真拉黑</span>
              </div>
              <h3 className="mt-2 text-xl font-bold text-ink">原生 Block：手机平板全端同步清净</h3>
              <p className="mt-2 text-sm text-mist leading-relaxed">
                为什么不做本地隐藏？因为本地隐藏是掩耳盗铃，只在当前浏览器把 DOM 节点设为 display:
                none，换个手机刷推依然骑脸。福滤娃直接调取 X 官方原生 Block
                接口，全端设备立刻同步消失。
              </p>
            </div>
            <ul className="mt-5 space-y-2 border-t border-line/50 pt-4 text-xs font-medium text-ink">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <span>手机 App 端即刻同步生效</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <span>彻底掐断后续私信与骚扰提示</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                <span>与网页手动屏蔽完全相同的安全通道</span>
              </li>
            </ul>
          </div>

          {/* Bento 3: 密码学验签（通栏） */}
          <div className="panel-card p-6 md:col-span-2 lg:col-span-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-gold">
                <Lock className="size-5" />
                <span className="text-xs font-bold uppercase tracking-wider">密码学防投毒</span>
              </div>
              <h3 className="mt-2 text-xl font-bold text-ink">
                纯数学验签：Ed25519 签名防篡改与透明开源
              </h3>
              <p className="mt-2 text-sm text-mist leading-relaxed">
                所有分发的黑名单快照与规则包均附带官方 Ed25519
                数字签名。浏览器扩展在本地沙箱内用预置公钥严格验签通过才加载生效，杜绝任何中间人投毒篡改。3,144
                条黑名单与 778 条词库全量开源，任何人均可随时审计。
              </p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line/50 pt-4 text-xs">
              <Link
                to="/lists/keywords"
                className="inline-flex items-center gap-1 font-semibold text-gold hover:underline"
              >
                <span>查验 778 条开源词库</span>
                <ArrowRight className="size-3" />
              </Link>
              <span className="text-fog">·</span>
              <Link
                to="/lists/whitelist"
                className="inline-flex items-center gap-1 font-semibold text-mist hover:text-ink"
              >
                <span>查验推荐白名单</span>
              </Link>
              <span className="text-fog">·</span>
              <Link
                to="/lists/rescue"
                className="inline-flex items-center gap-1 font-semibold text-mist hover:text-ink"
              >
                <span>查验社区抢救名单</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 5. 对比表格：为什么选择福滤娃？ */}
      <section className="mt-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            传统屏蔽方案 vs 福滤娃
          </h2>
          <p className="mt-2 text-sm text-mist">告别掩耳盗铃，拥抱安全、全端同步的现代清理方案。</p>
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[var(--panel-elev)]">
          <div className="grid grid-cols-3 border-b border-line/60 bg-soft-surface/80 p-4 text-xs font-bold text-ink sm:text-sm">
            <div>维度</div>
            <div className="text-mist">传统脚本 / 隐藏插件</div>
            <div className="text-gold font-extrabold">福滤娃 FeedSieve</div>
          </div>
          <div className="divide-y divide-line/50 text-xs sm:text-sm">
            <ComparisonRow
              dimension="清理彻底程度"
              bad="仅当前网页 display: none，手机端照常骑脸"
              good="调用 X 原生 Block，电脑手机 iPad 全端即刻清空"
            />
            <ComparisonRow
              dimension="推特账号安全性"
              bad="无节制高频请求，轻易触发 429 遭官方封禁"
              good="400 发/天配额 + 智能时间抖动 + 429 自动装死熔断"
            />
            <ComparisonRow
              dimension="内容透明度"
              bad="暗箱全盲盒吞推文，不知道错过了什么"
              good="只框不藏，证据原样贴出，拉黑权完全在你手里"
            />
            <ComparisonRow
              dimension="误伤挽救机制"
              bad="误伤了无解，甚至不知道拉黑了谁"
              good="关注列表自动免死金牌，已拉黑一秒解封，社区抢救投票"
            />
            <ComparisonRow
              dimension="隐私与代码透明"
              bad="可能窃取 Cookies 或上传敏感浏览历史"
              good="100% 开源，本地沙箱运算，凭证永不出设备"
            />
          </div>
        </div>
      </section>

      {/* 5.5 数据从哪来：主页分析的三种取数方式 */}
      <section className="mt-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">数据从哪来</h2>
          <p className="mt-2 text-sm text-mist">
            分析博主的工具不少，拿数据的方式决定了你的 X 账号安不安全。
          </p>
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[var(--panel-elev)]">
          <div className="grid grid-cols-3 border-b border-line/60 bg-soft-surface/80 p-4 text-xs font-bold text-ink sm:text-sm">
            <div>做法</div>
            <div className="text-mist">能看多少</div>
            <div className="text-mist">对你账号的风险</div>
          </div>
          <div className="divide-y divide-line/50 text-xs sm:text-sm">
            <SourceRow method="扩展自动滚动页面" reach="几百条" risk="大号容易触发验证码和限流" />
            <SourceRow
              method="用你的登录会话直接请求 X 接口"
              reach="一年甚至全部"
              risk="X 条款禁止爬取，风控算在你头上"
            />
            <SourceRow
              method="福滤娃：只读页面已经加载的数据"
              reach="你看到多少算多少，可一键搜高赞帖补齐"
              risk="无：不滚动、不翻页、不额外请求 X"
              highlight
            />
          </div>
        </div>
      </section>

      {/* 6. 交互式 FAQ 折叠区 */}
      <section className="mt-20">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
            <Shield className="size-4 text-gold" />
            <span>问答与解惑</span>
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            常见问题解答
          </h2>
          <p className="mt-2 text-sm text-mist">
            你想了解的一切安全机制与设计细节，这里都敞开说明。
          </p>
        </div>

        <div className="mt-8 space-y-3.5 max-w-3xl mx-auto">
          <FaqItem
            q="会封我自己的推特账号吗？"
            a="推特天天治不了批量黄推，但对正常用户的高频操作抓得贼严。我们比你更怕被封大号：内置 400 发/24小时滚动配额，外加拟人化随机时间抖动；一旦检测到 X 返回 429 限流，立即触发「装死休眠熔断」，宁可停下来歇歇，也绝不拿你的大号去试探风控底线。"
          />
          <FaqItem
            q="为什么坚持原生拉黑，而不是简单的本地隐藏（CSS display: none）？"
            a="本地隐藏纯属鸵鸟战术。它只在当前这个浏览器网页把 DOM 节点 display: none，换个手机刷推，那些「那一夜你没有拒绝我」依然在你评论区疯狂骑脸。只有走 X 原生 Block 接口，才能做到全端同步、彻底清静。"
          />
          <FaqItem
            q="误伤了怎么办？怎样防止拉黑到自己喜欢的博主？"
            a={
              <div className="space-y-2">
                <p>我们设计了三重防误伤保障：</p>
                <p>① 关注列表本地自动免疫：你的关注就是免死金牌，绝对不碰你关注的人；</p>
                <p>② 插件「已拉黑」面板里点「放回来」一秒撤销恢复；</p>
                <p>
                  ③ 社区开放申诉与抢救机制，误标账号经共识复核即可迅速解封入册（见{' '}
                  <Link to="/lists/apply" className="font-semibold text-gold hover:underline">
                    申诉入册
                  </Link>
                  ）。
                </p>
              </div>
            }
          />
          <FaqItem
            q="会收集我的浏览历史、私信或登录凭证吗？"
            a={
              <div className="space-y-2">
                <p>
                  不会。检测、热帖和主页分析都在你的浏览器里完成，浏览历史、私信、Cookie 和 X
                  凭证从不上传。
                </p>
                <p>
                  会离开设备的只有两类，都可以关：你明确拉黑或加白的账号（「名单上传」），以及正在火的公开帖子指标（「全站热榜」，不带你的账号）。打开「仅本地运行」后什么都不上传。完整说明见{' '}
                  <a
                    href={`${GITHUB_URL}/blob/main/PRIVACY.md`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-gold hover:underline"
                  >
                    隐私政策
                  </a>
                  。
                </p>
              </div>
            }
          />
          <FaqItem
            q="热帖和主页的数据是从哪来的？"
            a="都来自你正常浏览时 X 已经加载给页面的内容。扩展不会替你滚动页面、不会翻页，也不会为此额外请求 X。热帖数据关闭浏览器就清空；博主主页的帖子存在本机，不设数量上限、不淘汰，可在设置里一键清空。"
          />
          <FaqItem
            q="分析别人的主页会不会让我的号被封？"
            a="不会多出风险。福滤娃不自动滚动，也不用你的登录会话去批量请求 X，X 看到的就是你自己在正常浏览。想多看一些，可以点「在 X 搜高赞帖」，那是一次普通的 X 搜索；也可以用 Google 站内搜索，完全不经过 X。"
          />
          <FaqItem
            q="全站热榜上传了什么？"
            a="只上传流速达到每小时 1000 浏览的公开帖子的指标（帖子 ID、作者、正文前 280 字、各项计数），每 30 分钟最多一次，带一个每天更换的随机编号。不带你的账号、Cookie 或安装 ID；私信、通知、书签、列表里看到的帖子和你自己的帖子都不上传。服务器 72 小时后删除。可以在设置里关闭。"
          />
          <FaqItem
            q="支持哪些浏览器？需要额外注册账号吗？"
            a="完美支持 Chrome、Edge、Brave、Arc、Vivaldi 以及任何基于 Chromium 内核的现代浏览器。Edge 用户甚至可以直接从 Chrome 应用商店点击添加。装好即用，完全不需要注册任何第三方账号。"
          />
        </div>
      </section>

      {/* 7. 底部行动呼吁 CTA BANNER */}
      <section className="mt-20">
        <div className="relative overflow-hidden rounded-3xl border border-gold/40 bg-gradient-to-b from-gold-surface/40 to-surface p-8 sm:p-12 text-center shadow-[var(--panel-elev)]">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              评论区清净了，好帖也不再错过
            </h2>
            <p className="mt-3 text-base text-mist leading-relaxed">
              装上福滤娃，黄推自动标出，火帖自动收集，打开任意博主主页就能看到他的爆款。
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-bold text-primary-foreground shadow-lg transition-all hover:scale-[1.02] hover:opacity-95 active:scale-98"
              >
                <span>免费安装扩展</span>
                <ArrowRight className="size-4" />
              </a>
              <Link
                to="/guide"
                className="inline-flex h-12 items-center rounded-full bg-surface px-6 text-sm font-semibold text-ink shadow-sm border border-line/70 transition-all hover:bg-wash-strong"
              >
                查看新手教程
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-surface px-6 text-sm font-semibold text-mist hover:text-ink shadow-sm border border-line/70 transition-all hover:bg-wash-strong"
              >
                <GithubIcon className="size-4" />
                <span>Star 支持一下</span>
              </a>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-fog">
              <span>✓ 免 API Key</span>
              <span>✓ 只读页面数据</span>
              <span>✓ MIT 开源协议</span>
              <span>✓ 400发安全保护</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  number,
  label,
  desc,
  link,
}: {
  number: string;
  label: string;
  desc: string;
  link: string;
}) {
  const isInternal = link.startsWith('/');
  const content = (
    <div className="panel-card p-5 h-full transition-all hover:scale-[1.01] hover:shadow-md">
      <div className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{number}</div>
      <div className="mt-1 text-sm font-bold text-gold">{label}</div>
      <div className="mt-1 text-xs text-mist leading-relaxed">{desc}</div>
    </div>
  );

  if (isInternal) {
    return <Link to={link}>{content}</Link>;
  }
  return (
    <a href={link} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  );
}

function ShowcaseCard({
  icon,
  kicker,
  title,
  image,
  alt,
  points,
}: {
  icon: ReactNode;
  kicker: string;
  title: string;
  image?: string;
  alt?: string;
  points: string[];
}) {
  return (
    <div className="panel-card flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
      {image ? (
        <img
          src={image}
          alt={alt ?? ''}
          width={200}
          height={360}
          loading="lazy"
          className="mx-auto w-[200px] shrink-0 rounded-xl border border-line/70 shadow-[var(--panel-elev)] sm:mx-0"
        />
      ) : null}
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-gold">
          {icon}
          <span className="text-xs font-bold uppercase tracking-wider">{kicker}</span>
        </div>
        <h3 className="mt-2 text-lg font-bold text-ink">{title}</h3>
        <ul className="mt-3 space-y-2 text-sm text-mist leading-relaxed">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SourceRow({
  method,
  reach,
  risk,
  highlight = false,
}: {
  method: string;
  reach: string;
  risk: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-3 items-center gap-2 p-4 ${highlight ? 'bg-gold-surface/30 font-semibold text-ink' : 'text-mist'}`}
    >
      <div className={highlight ? 'font-bold text-gold' : 'font-bold text-ink'}>{method}</div>
      <div className="text-xs leading-relaxed">{reach}</div>
      <div className="flex items-start gap-1.5 text-xs leading-relaxed">
        {highlight ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
        )}
        <span>{risk}</span>
      </div>
    </div>
  );
}

function ComparisonRow({ dimension, bad, good }: { dimension: string; bad: string; good: string }) {
  return (
    <div className="grid grid-cols-3 p-4 items-center gap-2">
      <div className="font-bold text-ink">{dimension}</div>
      <div className="flex items-start gap-1.5 text-mist text-xs leading-relaxed">
        <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
        <span>{bad}</span>
      </div>
      <div className="flex items-start gap-1.5 text-ink text-xs font-semibold leading-relaxed">
        <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
        <span>{good}</span>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)] transition-all">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-sm text-ink select-none">
        <span>{q}</span>
        <ChevronDown className="size-4 shrink-0 text-fog transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="mt-3 text-xs text-mist leading-relaxed border-t border-line/40 pt-3">{a}</div>
    </details>
  );
}
