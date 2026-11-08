import { Link } from '@tanstack/react-router';
import {
  Download,
  PlayCircle,
  ShieldAlert,
  Settings2,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Flame,
  TrendingUp,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { CHROME_STORE_URL, FIREFOX_STORE_URL, GITHUB_URL } from '../site';
import { InstallButtons } from '../components/InstallButtons';

/**
 * 教程页：全平台安装、核心理念、四种实战流派、400发防封安全边界、
 * 防误伤三重金钟罩、热帖、博主主页洞察、进阶设置与故障排查。
 */
export default function GuidePage() {
  return (
    <main className="mx-auto max-w-4xl px-[clamp(18px,2.2vw,34px)] py-10 sm:py-14">
      {/* 头部标题与定位 */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold-surface px-3.5 py-1 text-xs font-semibold text-gold">
          <Flame className="size-3.5" />
          <span>福滤娃完整实战与进阶手册</span>
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl text-ink">
          福滤娃使用教程与实战指南
        </h1>
        <p className="mt-2 text-base text-mist leading-relaxed">
          从安装配置、清理黄推、400
          发防封机制、防误伤，到热帖榜和博主主页洞察，一篇讲清福滤娃怎么用。
        </p>
      </div>

      {/* 锚点导航胶囊 */}
      <nav className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="教程目录">
        {[
          ['安装方式', 'install'],
          ['核心理念', 'concept'],
          ['上手四步', 'start'],
          ['400发防封边界', 'safety'],
          ['防误伤金钟罩', 'shield'],
          ['热帖', 'hot'],
          ['博主主页洞察', 'profile'],
          ['设置与迁移', 'settings'],
          ['常见问题与排查', 'faq'],
        ].map(([label, id]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold text-mist shadow-sm border border-line/60 transition-all hover:border-ink/20 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* 1. 安装方式 */}
      <section id="install" className="mt-12 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <Download className="size-5 text-gold" />
          <h2>一、全平台安装与初始化</h2>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[var(--panel-elev)]">
          <table className="w-full text-left text-sm" data-testid="guide-table">
            <tbody className="divide-y divide-line/50">
              <GuideRow label="Chrome 应用商店">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={CHROME_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-gold hover:underline underline-offset-4"
                    >
                      <span>点「添加至 Chrome」，享受自动后台更新</span>
                      <ExternalLink className="size-3.5" />
                    </a>
                    <span className="rounded bg-gold-surface px-2 py-0.5 text-xs font-medium text-gold">
                      官方审核 · 自动同步
                    </span>
                  </div>
                  <p className="text-xs text-mist leading-relaxed">
                    Edge、Brave、Arc、Vivaldi、Opera 等 Chromium 内核浏览器均支持。Edge
                    用户首次打开页面点顶部提示「允许来自其他应用商店的扩展」即可。
                  </p>
                </div>
              </GuideRow>

              <GuideRow label="Firefox 附加组件（AMO）">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={FIREFOX_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-gold hover:underline underline-offset-4"
                    >
                      <span>点「添加到 Firefox」，享受自动后台更新</span>
                      <ExternalLink className="size-3.5" />
                    </a>
                    <span className="rounded bg-gold-surface px-2 py-0.5 text-xs font-medium text-gold">
                      官方审核 · 自动同步
                    </span>
                  </div>
                  <p className="text-xs text-mist leading-relaxed">
                    Firefox 版与 Chrome 版同一套代码（MV3），侧边栏换成原生 sidebar_action。AMO
                    上另有第三方转载的 0.8.2「feedsieve」条目，不是本项目发布， 请认准「FeedSieve
                    福滤娃」。
                  </p>
                </div>
              </GuideRow>

              <GuideRow label="GitHub Releases 离线包">
                <div className="space-y-1.5 leading-relaxed text-xs sm:text-sm">
                  <div>
                    1. 前往{' '}
                    <a
                      href={`${GITHUB_URL}/releases`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-ink underline-offset-4 hover:underline"
                    >
                      GitHub Releases
                    </a>{' '}
                    下载最新{' '}
                    <code className="rounded bg-soft-surface px-1.5 py-0.5 font-mono">
                      feedsieve-chrome.zip
                    </code>{' '}
                    并解压至本地固定文件夹；
                  </div>
                  <div>
                    2. 打开浏览器地址栏访问{' '}
                    <code className="rounded bg-soft-surface px-1.5 py-0.5 font-mono text-ink">
                      chrome://extensions
                    </code>
                    ；
                  </div>
                  <div>
                    3. 勾选右上角<strong>「开发者模式」</strong>开关；
                  </div>
                  <div>
                    4. 点击左上角<strong>「加载已解压的扩展程序」</strong>，选择刚解压的文件夹即可。
                  </div>
                </div>
              </GuideRow>

              <GuideRow label="从源码自构建（极客）">
                <div className="space-y-1 text-xs sm:text-sm">
                  <div>克隆仓库并在根目录运行：</div>
                  <pre className="overflow-x-auto rounded-xl bg-soft-surface p-3 font-mono text-xs text-ink">
                    pnpm install && pnpm build:extension
                  </pre>
                  <div className="text-xs text-mist">
                    产物将生成在{' '}
                    <code className="font-mono">apps/extension/.output/chrome-mv3</code>
                    ，按离线包方式加载即可。
                  </div>
                </div>
              </GuideRow>
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-xl border border-line/60 bg-soft-surface p-4 text-xs text-mist leading-relaxed">
          <strong className="text-ink">💡 装好后的第一件事：</strong>
          点击浏览器右上角的「拼图图标」🧩，将 <strong>福滤娃 FeedSieve</strong>{' '}
          图标固定（Pin）到浏览器工具栏。此时打开任意{' '}
          <code className="text-ink font-mono">x.com</code> 页面，扩展会自动激活，
          <strong>无需注册任何账号、无需配置任何 API Key</strong>。
        </div>
      </section>

      {/* 2. 核心理念与黄框识别 */}
      <section id="concept" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <Layers className="size-5 text-gold" />
          <h2>二、核心设计理念：只框不藏</h2>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)] space-y-2">
            <h3 className="font-bold text-ink text-sm flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-500" />
              为什么坚持“只框不藏”？
            </h3>
            <p className="text-xs text-mist leading-relaxed">
              很多插件喜欢粗暴地搞 <code className="font-mono">display: none</code>
              ，把你屏幕上的推文节点吞掉。这不仅是掩耳盗铃（换个手机照样骑脸），而且会造成极严重的“信息盲盒”——你根本不知道它吞了什么、为什么吞，甚至可能吞掉正常博主的优质反驳。福滤娃看到什么就标注什么，机器与算法是雷达，最终决定权永远在你自己手里。
            </p>
          </div>

          <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)] space-y-2">
            <h3 className="font-bold text-ink text-sm flex items-center gap-2">
              <CheckCircle2 className="size-4 text-gold" />
              黄框上的徽章看什么？
            </h3>
            <p className="text-xs text-mist leading-relaxed">
              高置信垃圾账号被醒目黄框标出后，推文底部会附带一行黄色依据徽章。例如：
              <code className="rounded bg-gold/15 px-1.5 py-0.5 text-gold-deep font-semibold">
                黄推 / 成人引流 · 命中话术库
              </code>
              、
              <code className="rounded bg-gold/15 px-1.5 py-0.5 text-gold-deep font-semibold">
                搬运套路复读机
              </code>{' '}
              或{' '}
              <code className="rounded bg-gold/15 px-1.5 py-0.5 text-gold-deep font-semibold">
                外链诈骗跳转
              </code>
              。判定依据完全明牌，杜绝莫须有。
            </p>
          </div>
        </div>
      </section>

      {/* 3. 上手四步：实战流派 */}
      <section id="start" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <PlayCircle className="size-5 text-gold" />
          <h2>三、日常清理四种实战流派</h2>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <StepCard
            step="01"
            title="随缘单点流（顺手送走）"
            badge="高频日常"
            desc="日常刷推滚动时间线，如果看到被黄框标出的垃圾账号，推文右上角直接提供「顺手拉黑」按钮。看一眼证据，随手一点，立即调用 X 官方 Block 接口，手机端与平板端即刻同步消失。"
          />
          <StepCard
            step="02"
            title="批量扫荡流（攒一批一键送走）"
            badge="强迫症狂喜"
            desc="时间线上所有进入过屏幕视野的黄标账号，会自动暂存进扩展待拉黑队列。刷完推文后，点击右上角扩展图标，核对列表后点击「一键拉黑全部」，扩展将自动以拟人化安全节奏逐个执行出弹。"
          />
          <StepCard
            step="03"
            title="手动补刀流（标记漏网之鱼）"
            badge="精准补刀"
            desc="新型伪装变种或漏网的灰产账号？点击该推文右上角的菜单图标「···」，选择「标记垃圾并拉黑」。系统在本地即刻为你屏蔽，同时提取脱敏话术特征。"
          />
          <StepCard
            step="04"
            title="瞬时撤销流（误伤一秒救回）"
            badge="后悔药"
            desc="手滑误拉黑了感兴趣的博主或朋友？完全不用慌。打开扩展弹窗进入「已拉黑」列表，找到对应账号点击「放回来」，系统秒级调用 Unblock 接口解除屏蔽并撤回，安全感拉满。"
          />
        </div>
      </section>

      {/* 4. 400 发防封与安全边界 */}
      <section id="safety" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <ShieldAlert className="size-5 text-gold" />
          <h2>四、批量拉黑的安全边界（400 发防封风控机制）</h2>
        </div>

        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 dark:bg-amber-500/10 space-y-4">
          <div>
            <h3 className="font-bold text-ink text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-gold" />
              推特天天治不了批量黄推，但对正常用户的高频拉黑抓得极严！
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-mist leading-relaxed">
              拉黑动作走的是你在浏览器当前已登录的合法推特
              Session，这与你手动在网页上点屏蔽是完全相同的数据通道。但推特内部对普通用户的写操作有非常严格的限流阈值。如果脚本毫无顾忌地几秒内发几百个请求，你的大号大概率会被官方暂时限流（429）甚至风控限制。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-line/70 bg-surface p-4 space-y-1.5">
              <div className="font-bold text-ink">🎯 400 发 / 24 小时配额</div>
              <p className="text-mist leading-relaxed">
                本地队列严格锁定 24 小时滑动窗口内最多 400
                发拉黑配额。配额用尽后队列自动休眠暂停，直到窗口释放。大名单请分几天跑完，别指望一晚把全网清零。
              </p>
            </div>
            <div className="rounded-xl border border-line/70 bg-surface p-4 space-y-1.5">
              <div className="font-bold text-ink">🎲 拟人化随机时间抖动</div>
              <p className="text-mist leading-relaxed">
                每次批量拉黑之间注入 800ms ~ 2500ms
                的随机延迟抖动（Jitter），彻底打碎机械高频特征，模拟真实用户的浏览与点击习惯。
              </p>
            </div>
            <div className="rounded-xl border border-line/70 bg-surface p-4 space-y-1.5">
              <div className="font-bold text-ink">🛑 429 智能装死熔断</div>
              <p className="text-mist leading-relaxed">
                一旦 X 接口返回 429 Too Many Requests
                限流响应，扩展立即启动保护熔断进入休眠冷却，绝不拿你的推特大号去硬赌风控底线。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. 防误伤三重金钟罩 */}
      <section id="shield" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <ShieldCheck className="size-5 text-gold" />
          <h2>五、防误伤三重金钟罩</h2>
        </div>

        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)]">
            <div className="flex items-center gap-2 font-bold text-sm text-ink">
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 px-2 py-0.5 text-xs">
                第一重
              </span>
              <span>关注列表本地自动豁免（免死金牌）</span>
            </div>
            <p className="mt-2 text-xs text-mist leading-relaxed">
              打开扩展设置页，点击「同步关注列表」。扩展会自动将你当前所有的
              Following（关注博主）存入本地免检白名单中。在本地检测流水线中，关注列表拥有
              <strong>最高绝对豁免权</strong>
              ，任何检测规则或黑名单都绝不触碰你关注的人。关注数据纯本地保存，永不上传服务器。
            </p>
          </div>

          <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)]">
            <div className="flex items-center gap-2 font-bold text-sm text-ink">
              <span className="rounded-full bg-gold-surface text-gold px-2 py-0.5 text-xs">
                第二重
              </span>
              <span>已拉黑面板「放回来」秒级撤销</span>
            </div>
            <p className="mt-2 text-xs text-mist leading-relaxed">
              扩展弹窗提供独立的「已拉黑」历史列表。所有通过扩展执行的拉黑均有痕迹，支持输入账号关键词快速搜索；点击任意账号右侧的「放回来」按钮，立即撤销拉黑并在推特端恢复正常。
            </p>
          </div>

          <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)]">
            <div className="flex items-center gap-2 font-bold text-sm text-ink">
              <span className="rounded-full bg-sky-500/15 text-sky-600 px-2 py-0.5 text-xs">
                第三重
              </span>
              <span>社区抢救名单与公开申诉入册</span>
            </div>
            <p className="mt-2 text-xs text-mist leading-relaxed">
              社区如果发现某位正常博主被恶意刷票误伤，其他用户在扩展内点击抢救，系统根据净票机制（拉黑票
              − 抢救票 &lt; 3）自动将其从全量黑名单中剔除；博主本人也可以在{' '}
              <Link to="/lists/apply" className="text-gold font-semibold hover:underline">
                官网申诉页
              </Link>{' '}
              发起申请，经邮箱验证后进入维护者人工复核队列解封。
            </p>
          </div>
        </div>
      </section>

      {/* 6. 关键设置与配置迁移 */}
      {/* 6. 热帖 */}
      <section id="hot" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <TrendingUp className="size-5 text-gold" />
          <h2>六、热帖：刷过的火帖一个不漏</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <GuideCard title="推文上的流速与量级">
            推文右上角的数字是当前每小时浏览数：绿色是平稳，<strong>1K/h</strong> 以上变红，
            <strong>10K/h</strong> 以上实心红。作者名旁是量级（微光 / 新芽 / 新锐 / 星火 / 人气 /
            达人 / 知名 / 影响力 / 头部 /
            顶流）和粉丝数，悬停能看关注比、注册时间和疑似互关号提示。设置里「流速与量级」可以关掉。
          </GuideCard>
          <GuideCard title="我刷到的">
            点扩展图标进「热帖」，汇总你最近 2 小时在所有 X 标签页刷到、每小时 1000
            浏览以上的帖子。可以按热度、回复机会、粉丝数、收藏数、最近刷到排序；建议点右上角图标把它挂进侧边栏，边刷边看。
          </GuideCard>
          <GuideCard title="全站">
            切到「全站」看所有福滤娃用户刷到的火帖，至少 3
            个人看到才上榜。参与上报只传正在火的公开帖子指标，不带你的账号，可在设置里关闭「参与全站热榜」。
          </GuideCard>
          <GuideCard title="几个顺手的操作">
            鼠标在列表上时新帖不会插进来，顶部出提示条，点一下再换；头像下方的 ×
            可以不看这条或这个作者；键盘 j / k 上下、Enter 打开、r 回复、x 不看。
          </GuideCard>
        </div>
      </section>

      {/* 7. 博主主页洞察 */}
      <section id="profile" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <Search className="size-5 text-gold" />
          <h2>七、博主主页洞察：看他的爆款</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <GuideCard title="怎么打开">
            打开任意博主的 X
            主页往下滚一点，资料卡下面会出现一行概况：量级、粉丝、关注比、中位浏览、爆款率、已收条数。点它，或者点扩展图标，会直接进「主页」。
          </GuideCard>
          <GuideCard title="爆款倍数">
            每条帖子的浏览 ÷ 他自己帖子浏览的中位数，3 倍以上标金色。基线只算原创和引用、发出满 24
            小时的帖子；刚发的帖子按预计 24 小时浏览估算，前面带 ~。
          </GuideCard>
          <GuideCard title="收得不够怎么办">
            扩展只收你看到的帖子，不会替你滚动。想一次补齐他最好的那批，点放大镜图标「在 X
            搜高赞帖」，会打开一次普通的 X 搜索，搜到的帖子自动收进来；地球图标是 Google
            站内搜索，可以按关键词和时间范围找。
          </GuideCard>
          <GuideCard title="带走数据">
            闪光图标把倍数最高的 20 条整理成带分析要求的 Markdown，直接粘贴给 ChatGPT 或
            Claude；下载图标导出当前筛选下的 CSV。主页数据存在本机，设置里「清空主页数据」一键删除。
          </GuideCard>
        </div>
      </section>

      <section id="settings" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <Settings2 className="size-5 text-gold" />
          <h2>八、关键设置与配置迁移</h2>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SettingItem
            title="词库包按需勾选"
            desc={
              <>
                官方提供 8 个场景规则包共 778
                条公开规则（黄推/成人引流、套路引流、机器人特征等），默认仅开启「黄推引流」，其他分类随心按需订阅。所有规则公开在{' '}
                <Link to="/lists/keywords" className="font-semibold text-gold hover:underline">
                  开源词库
                </Link>
                。
              </>
            }
          />
          <SettingItem
            title="识别灵敏度三档调节"
            desc="提供 清爽 / 标准 / 大扫除 三档。清爽档只抓高置信度核心特征；大扫除档覆盖更多模糊变种。无论哪一档，黄框标注在任何时候都绝不执行任何静默拉黑。"
          />
          <SettingItem
            title="配置与白名单本地导出"
            desc="支持将你在本地沉淀的自定义白名单、已拉黑记录与偏好设置一键导出为纯 JSON 文件，数据干净明牌，绝不夹带任何推特 Session 凭证。"
          />
          <SettingItem
            title="更换设备一键合并还原"
            desc="换新电脑或在新浏览器安装扩展后，在设置页点击「导入配置」选择此前导出的 JSON 文件，即可秒级还原你的所有保护白名单与个人拉黑规则。"
          />
        </div>
      </section>

      {/* 7. 常见问题排查 FAQ */}
      <section id="faq" className="mt-14 scroll-mt-20">
        <div className="flex items-center gap-2 text-xl font-bold text-ink">
          <HelpCircle className="size-5 text-gold" />
          <h2>九、常见问题与故障排查 FAQ</h2>
        </div>

        <div className="mt-4 space-y-3">
          <FaqItem
            q="刷推时没有看到黄框标出，怎么排查？"
            a={
              <div className="space-y-1.5">
                <p>请按以下步骤快速排查：</p>
                <p>① 确认浏览器右上角的福滤娃扩展图标处于彩色激活状态；</p>
                <p>② 刷新当前推特页面（按 Ctrl+F5 或 Cmd+Shift+R 硬刷新一次）；</p>
                <p>③ 检查设置中是否开启了关键词词库包（默认已开启成人引流包）；</p>
                <p>
                  ④
                  检查被测试的账号是否已经在你的「关注列表」中（你关注的人享有本地免死金牌，绝对不会被黄框标出）。
                </p>
              </div>
            }
          />

          <FaqItem
            q="为什么坚持是原生拉黑，而不是本地隐藏（CSS display: none）？"
            a="本地隐藏纯属鸵鸟战术。它只在当前这个浏览器网页把 DOM 节点 display: none 遮住，换到手机或平板刷推依然被黄推骑脸。福滤娃直接调取 X 官方 Block 接口，全端设备立刻同步消失，彻底切断私信与骚扰通知。"
          />

          <FaqItem
            q="批量拉黑遇到 429 提示休眠，我该怎么办？"
            a="完全不用担心，这正是 429 智能装死熔断机制在保护你的大号！说明你在短时间内发起的推特写请求达到了官方阶段性限流阈值。此时扩展会自动停止出弹并休眠；你无需做任何额外操作，正常刷推即可，冷却倒计时结束后将自动恢复。"
          />

          <FaqItem
            q="我的推特密码、Cookie 或私信会被上传吗？"
            a="绝对不会！福滤娃 100% 遵守开源透明底线：检测规则在本地浏览器沙箱运行；拉黑直接借用浏览器中已有的正常会话向 X 发起请求，服务器完全接触不到你的账号密码。社区上报内容仅包含匿名的账号 handle、违规分类标签、话术特征哈希与外链域名，绝不包含推文正文或个人浏览足迹。"
          />

          <FaqItem
            q="推特账号换了名字或马甲，还能识别出它吗？"
            a="能！福滤娃不仅看账号名字，更核心的是比对「话术特征哈希指纹」和「引流外链根域名」。骗子和引流机器人哪怕一天换 10 个 @handle，只要话术模板或外链跳转域名命中，依然会被黄框秒级抓包锁定。"
          />

          <FaqItem
            q="支持哪些浏览器？需要在插件里注册账号吗？"
            a="完美支持 Chrome、Edge、Brave、Arc、Vivaldi 以及任何基于 Chromium 内核的现代浏览器。装好即用，完全不需要注册任何第三方平台账号或付费购买 API Key。"
          />

          <FaqItem
            q="打开 x.com 只看到「Something went wrong」和隐私扩展红条，是福滤娃导致的吗？"
            a={
              <div className="space-y-1.5">
                <p>
                  不是福滤娃拦的。福滤娃没有网络拦截能力：权限只有 storage、unlimitedStorage 和
                  sidePanel，站点权限只有 x.com，没有 webRequest 或 declarativeNetRequest，
                  不拦任何请求；它在页面里只做本地只读识别，不改请求、也不改响应。
                </p>
                <p>
                  那个页面是 X
                  自己的兜底页：网页外壳里预埋了一块隐藏的报错面板（#ScriptLoadFailure），
                  页尾内联脚本检查 window.__SCRIPTS_LOADED__ 里的 main 标记，只要 X 自己的 main.js /
                  vendor.js 没加载成功、或 bundle
                  没执行完，就会显示这块面板。红条那句「隐私类扩展可能导致问题」 是 X
                  写死的通用文案，不是它检测到了福滤娃。
                </p>
                <p>
                  常见真实原因：代理或节点、DNS 把 abs.twimg.com 的脚本挡住；其它广告或隐私扩展、
                  浏览器严格跟踪保护；网络抖动，或杀毒软件、公司代理的 MITM；以及 X 的 Cloudflare
                  边缘风控拦了当前会话。按下面顺序排查：
                </p>
                <p>
                  ① 硬刷新（Cmd+Shift+R / Ctrl+F5）；换一个代理节点或改用手机热点；关掉其它广告 /
                  隐私扩展，浏览器跟踪保护调回「标准」；
                </p>
                <p>
                  ② 按 F12 打开 Network 和 Console，看 abs.twimg.com 下的 main.*.js、vendor.*.js
                  是否加载失败（4xx / 5xx 或 net::ERR_*）；
                </p>
                <p>
                  ③ 在 Console 输入 window.__SCRIPTS_LOADED__，缺 main 或 vendor， 就说明 X
                  的核心脚本没跑起来；
                </p>
                <p>
                  ④ 点一次页面上的「Try again」，看地址栏的 ?failedScript=（会写明哪个脚本失败），
                  再清理 x.com 的站点数据重试；
                </p>
                <p>
                  ⑤ 对照：无痕窗口里只留福滤娃再试；只有这个组合稳定复现时，把控制台报错发到{' '}
                  <a
                    href={`${GITHUB_URL}/issues`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-gold hover:underline"
                  >
                    GitHub Issues
                  </a>
                  。
                </p>
                <p>
                  关掉某个扩展后刷新恰好恢复，多半只是巧合——那一下网络或风控状态变了。
                  这个提示对所有人都一样，不代表 X 真的识别到了某个扩展。
                </p>
              </div>
            }
          />
        </div>
      </section>

      {/* 底部引导 */}
      <section className="mt-14 rounded-2xl border border-gold/40 bg-gradient-to-b from-gold-surface/30 to-surface p-6 sm:p-8 text-center shadow-[var(--panel-elev)]">
        <h3 className="text-xl font-bold text-ink">一切准备就绪，开始体验清爽时间线</h3>
        <p className="mt-2 text-xs sm:text-sm text-mist">
          遇到任何未尽疑问或特殊反馈，欢迎前往 GitHub 社区与全球推友交流。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <InstallButtons
            size="sm"
            chromeLabel="一键添加至 Chrome"
            firefoxLabel="一键添加至 Firefox"
          />
          <Link
            to="/lists/blacklist"
            className="inline-flex h-10 items-center rounded-full bg-surface px-5 text-xs font-semibold text-ink shadow-sm border border-line/70 hover:bg-wash-strong transition-colors"
          >
            查验社区黑名单
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-full bg-surface px-5 text-xs font-semibold text-mist hover:text-ink shadow-sm border border-line/70 hover:bg-wash-strong transition-colors"
          >
            GitHub Issues 反馈
          </a>
        </div>
      </section>
    </main>
  );
}

function GuideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)]">
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
        <CheckCircle2 className="size-4 text-emerald-500" />
        {title}
      </h3>
      <p className="text-xs leading-relaxed text-mist">{children}</p>
    </div>
  );
}

function GuideRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="align-top">
      <td className="w-1/3 py-4 px-4 font-semibold text-ink sm:w-1/4 text-xs sm:text-sm">
        {label}
      </td>
      <td className="py-4 px-4 text-mist text-xs sm:text-sm">{children}</td>
    </tr>
  );
}

function StepCard({
  step,
  title,
  badge,
  desc,
}: {
  step: string;
  title: string;
  badge?: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)] transition-all hover:border-ink/20 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gold-surface font-mono text-xs font-bold text-gold">
              {step}
            </span>
            <h3 className="font-bold text-ink text-sm">{title}</h3>
          </div>
          {badge && (
            <span className="rounded-full bg-soft-surface border border-line/60 px-2 py-0.5 text-[10px] font-semibold text-mist">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-2.5 text-xs text-mist leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function SettingItem({ title, desc }: { title: string; desc: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line/70 bg-surface p-5 shadow-[var(--panel-elev)]">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <div className="mt-1.5 text-xs text-mist leading-relaxed">{desc}</div>
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
