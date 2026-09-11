/**
 * 官网页面：首页与名单公示页原文内嵌为模板字符串（Worker 直接返回 HTML，
 * 不再有独立静态站）。内容与原 site/public/*.html 保持一致，唯一的改动是
 * 公示页 API_BASE 置空 —— 页面与社区 API 同域名，直接同源请求。
 */

export function homePageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>福滤娃 FeedSieve — 不信你看。看不见就对了。</title>
  <meta name="description" content="开源的 X（Twitter）垃圾账号清理扩展：高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。" />
  <link rel="icon" type="image/png" href="/assets/avatar.png" />
  <meta property="og:title" content="福滤娃 FeedSieve" />
  <meta property="og:description" content="高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://feedsieve.win/" />
  <meta property="og:image" content="https://feedsieve.win/assets/screenshot-1-marked.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="top">
    <img src="/assets/avatar.png" width="40" height="40" alt="福滤娃头像" />
    <span class="brand">福滤娃 FeedSieve</span>
  </header>

  <main>
    <section class="hero">
      <h1>不信你看。<br />看不见就对了。</h1>
      <p class="lede">X（Twitter）赛博清洁工：高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。</p>
      <div class="actions">
        <a class="btn primary" href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph">Chrome 应用商店安装</a>
        <a class="btn" href="https://github.com/realchendahuang/feedsieve">GitHub</a>
      </div>
      <figure class="shot">
        <img src="/assets/screenshot-1-marked.png" alt="FeedSieve 在时间线上用黄框标注垃圾账号" />
      </figure>
    </section>

    <section class="pillars">
      <div class="pillar">
        <h2>黄框标注</h2>
        <p>只框不藏，判断理由可见</p>
      </div>
      <div class="pillar">
        <h2>原生拉黑</h2>
        <p>X 服务器执行，全端生效</p>
      </div>
      <div class="pillar">
        <h2>名单公开</h2>
        <p>开源仓库可审计</p>
      </div>
    </section>

    <section class="links">
      <a href="/guide">使用教程</a>
      <a href="/lists">名单公示</a>
      <a href="https://github.com/realchendahuang/feedsieve/blob/main/CHANGELOG.md">更新日志</a>
      <a href="https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md">隐私政策</a>
      <a href="https://github.com/realchendahuang/feedsieve/blob/main/CONTRIBUTING.md">参与贡献</a>
      <a href="https://github.com/realchendahuang/feedsieve/issues">反馈误标</a>
    </section>

    <section class="privacy">
      <p>判断在本地完成，推文原文不出设备。</p>
    </section>
  </main>

  <footer>
    <span>福滤娃 FeedSieve</span>
    <span>MIT · 开源</span>
  </footer>
</body>
</html>
`;
}

export function guidePageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>使用教程 — 福滤娃 FeedSieve</title>
  <meta name="description" content="FeedSieve 使用教程：安装、上手四步、打野排位、设置项、批量拉黑安全边界与常见问题。" />
  <link rel="icon" type="image/png" href="/assets/avatar.png" />
  <meta property="og:title" content="使用教程 — 福滤娃 FeedSieve" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="https://feedsieve.win/guide" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    .guide { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
    .guide h1 { font-size: 28px; margin: 0 0 8px; }
    .guide .lede { opacity: .7; margin: 0 0 24px; }
    .guide h2 { font-size: 20px; margin: 36px 0 12px; }
    .guide h3 { font-size: 16px; margin: 20px 0 8px; }
    .guide p, .guide li { line-height: 1.75; }
    .guide table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .guide td, .guide th { text-align: left; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); vertical-align: top; }
    .guide code { font-family: ui-monospace, monospace; background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 6px; padding: 2px 6px; font-size: .9em; }
    .guide .toc { margin: 16px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
    .guide .toc a { text-decoration: none; opacity: .8; }
  </style>
</head>
<body>
  <div class="nav">
    <div class="nav-inner">
      <a class="nav-brand" href="/">
        <img src="/assets/avatar.png" width="30" height="30" alt="福滤娃头像" />
        <span class="nav-brand-name">福滤娃 FeedSieve</span>
      </a>
    </div>
  </div>

  <main class="guide">
    <h1>使用教程</h1>
    <p class="lede">从安装到上榜，五分钟读完。</p>
    <ul class="toc">
      <li><a href="#install">安装</a></li>
      <li><a href="#start">上手四步</a></li>
      <li><a href="#hunting">打野排位</a></li>
      <li><a href="#settings">设置</a></li>
      <li><a href="#safety">批量拉黑安全</a></li>
      <li><a href="#faq">常见问题</a></li>
    </ul>

    <h2 id="install">安装</h2>
    <table>
      <tr><td>Chrome 应用商店（推荐）</td><td><a href="https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph">点「添加至 Chrome」，自动更新</a></td></tr>
      <tr><td>GitHub Releases</td><td><a href="https://github.com/realchendahuang/feedsieve/releases">下载 ZIP 解压</a> → <code>chrome://extensions</code> 开发者模式 → 加载已解压的扩展程序</td></tr>
      <tr><td>从源码构建</td><td><code>pnpm install &amp;&amp; pnpm build:extension</code>，加载 <code>apps/extension/.output/chrome-mv3</code></td></tr>
    </table>
    <p>Edge / Brave 等 Chromium 浏览器可用后两种方式。装好即用，无需注册任何账号。</p>

    <h2 id="start">上手四步</h2>
    <p><strong>刷 X，看黄框。</strong>打开 x.com 正常滚动，高置信垃圾账号被黄框标出，下方一行显示判定理由，内容不隐藏。</p>
    <p><strong>单个送走。</strong>黄框上点「顺手拉黑」：走你已登录 X 会话的内部 Block 接口，与手动点屏蔽同一条请求，手机端即刻同步消失。</p>
    <p><strong>攒一批一起送走。</strong>黄标账号自动进待拉黑列表，点「一键拉黑 N 个」逐个执行；成功移除，失败如实保留并给出原因。</p>
    <p><strong>漏网的自己补。</strong>任意推文操作栏点「标记垃圾并拉黑」，不需要理解检测规则。误伤了，已拉黑列表点「放回来」一键撤销。</p>

    <h2 id="hunting">打野排位</h2>
    <p>弹窗「打野」tab：<strong>战报</strong>（击杀 / 命中率 / 称号）、<strong>榜单速览</strong>（Top 10 + 你的排位）、完整<a href="/lists#ranked">周榜公示</a>。上榜默认匿名，想露脸需在弹窗认领档案并完成邮箱验证，可自愿绑定 @handle。</p>
    <p>计分：确认击杀 +1 · 首杀 +1 · 误伤 −2。按共识击杀计分，误拉黑不计分反而扣分。周赛季 ISO 周结算，Top 3 且命中率 ≥80% 获永久称号「猎黄人」。</p>

    <h2 id="settings">设置</h2>
    <p><strong>同步关注列表</strong>：把你的关注存为本地保护名单，自动排除在一切清理之外，永不上传。</p>
    <p><strong>关键词规则</strong>：官方 8 个词库包共 778 条公开规则，默认只开「黄推 / 成人引流」，其余按需订阅；全文<a href="/lists#keywords">公示在官网词库</a>。</p>
    <p><strong>识别强度</strong>：清爽 / 标准 / 大扫除 三档，只调证据用量；黄框标注在任何档位都永不自动批量拉黑。</p>
    <p><strong>备份与迁移</strong>：导出 JSON 在新设备合并，不含任何 X 登录态。</p>

    <h2 id="safety">批量拉黑的安全边界</h2>
    <p>拉黑走你的 X 登录会话，与手动点屏蔽是同一条请求。队列内置 <strong>400 条 / 24 小时</strong>滚动额度，用尽自动暂停（可选择继续）；连续 429 触发风暴降级（暂停 + 预算砍半），认证失效当天额度清零。大名单请让它分几天跑完，不要指望一个晚上清零。</p>

    <h2 id="faq">常见问题</h2>
    <p><strong>为什么是拉黑，而不是隐藏？</strong>本地隐藏只骗过你这一个浏览器；X 原生 Block 全端生效，被拉黑的号再也无法回复 / @ / 关注你。</p>
    <p><strong>需要 X 开发者 API 吗？</strong>不需要，拉黑全程在你已登录的 X 会话内完成，FeedSieve 服务器碰不到你的 X 账号。</p>
    <p><strong>推文会被上传吗？</strong>不会，推文原文永不出设备；社区上报只含账号名、分类、话术指纹哈希与外链域名。</p>
    <p><strong>被误标了怎么办？</strong>走<a href="/lists#apply">官网申诉</a>，邮箱验证后进维护者复核队列。</p>
    <p><strong>换号还能被识别吗？</strong>能：话术指纹、外链域名、换号别名追踪，换号不换模板照样命中。</p>
    <p>更细的口径与机制：工程文档见 <a href="https://github.com/realchendahuang/feedsieve/tree/main/docs">GitHub docs/</a>。</p>
  </main>

  <footer>
    <span><a href="/">首页</a></span>
    <span>福滤娃 FeedSieve</span>
    <span>MIT · 开源</span>
  </footer>
</body>
</html>
`;
}

export function listsPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0a0a0a" />
  <title>名单公示 — 福滤娃 FeedSieve</title>
  <meta name="description" content="FeedSieve 社区名单公开镜像：黑名单与白名单公示、打野周榜、博主宣言入册、误伤申诉。" />
  <link rel="icon" type="image/png" href="/assets/avatar.png" />
  <meta property="og:title" content="名单公示 — 福滤娃 FeedSieve" />
  <meta property="og:type" content="website" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="lists">
  <div class="nav">
    <div class="nav-inner">
      <a class="nav-brand" href="/">
        <img src="/assets/avatar.png" width="30" height="30" alt="福滤娃头像" />
        <span class="nav-brand-name">福滤娃 FeedSieve</span>
      </a>
      <nav class="tabs" role="tablist" aria-label="公示分区">
        <button class="tab" data-tab="blacklist" role="tab" type="button">黑名单<span class="count" id="blacklist-count"></span></button>
        <button class="tab" data-tab="whitelist" role="tab" type="button">白名单<span class="count" id="whitelist-count"></span></button>
        <button class="tab" data-tab="keywords" role="tab" type="button">词库<span class="count" id="keywords-count"></span></button>
        <button class="tab" data-tab="ranked" role="tab" type="button">排位赛</button>
      </nav>
      <div class="nav-actions">
        <details class="disclaimer">
          <summary aria-label="免责声明">!</summary>
          <div class="disclaimer-body">
            <p>
              黑名单是举报与抢救投票的聚合（拉黑票 − 误标票 ≥ 3），白名单是维护者认证与博主自荐——都反映社区意见，
              不构成对任何账号的事实认定；拉黑始终由扩展用户本人执行。
            </p>
            <a href="https://github.com/realchendahuang/feedsieve/blob/main/DISCLAIMER.md" target="_blank" rel="noopener noreferrer">完整免责声明 →</a>
          </div>
        </details>
        <button class="btn-primary" id="open-apply" type="button">申请</button>
      </div>
    </div>
  </div>

  <main>
    <section class="hero">
      <h2 class="hero-title">名单公示</h2>
      <p class="hero-sub" id="roster-meta">加载中…</p>
    </section>

    <section class="panel" id="panel-blacklist" role="tabpanel">
      <div class="stat-cards">
        <div class="stat-card">
          <span class="stat-label">黑名单总量</span>
          <span class="stat-value" id="stat-blacklist">—</span>
        </div>
        <div class="stat-card spot">
          <span class="stat-label">入榜门槛</span>
          <span class="stat-value">净票 ≥ 3</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">快照</span>
          <span class="stat-value stat-small" id="stat-version">—</span>
        </div>
      </div>
      <div class="panel-toolbar">
        <span class="panel-note" id="blacklist-note" hidden></span>
        <input type="search" id="blacklist-search" placeholder="搜账号" aria-label="搜索黑名单账号" />
      </div>
      <div class="table-card">
        <table id="blacklist-table">
          <thead>
            <tr><th>账号</th><th>分类</th><th>来源</th><th class="num">拉黑</th><th class="num">抢救</th><th class="num">净票</th><th>更新</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="empty" id="blacklist-empty" hidden>无匹配</p>
      </div>
      <div class="more-row">
        <button class="btn-ghost" id="blacklist-more" type="button" hidden></button>
      </div>
    </section>

    <section class="panel" id="panel-whitelist" role="tabpanel" hidden>
      <div class="panel-toolbar"><span class="panel-note">维护者认证 · 一票豁免任何标注</span></div>
      <div class="table-card">
        <table id="whitelist-table">
          <thead>
            <tr><th>账号</th><th>宣言 / 入册说明</th><th>入册</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="empty" id="whitelist-empty" hidden>暂无认证账号</p>
      </div>
      <div class="panel-toolbar spaced"><span class="panel-note">社区抢救 · 被验证为「误标正常」的账号</span></div>
      <div class="table-card">
        <table id="verified-table">
          <thead>
            <tr><th>账号</th><th class="num">抢救</th><th class="num">拉黑</th><th class="num">净票</th><th>更新</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="empty" id="verified-empty" hidden>暂无记录</p>
      </div>
    </section>

    <section class="panel" id="panel-keywords" role="tabpanel" hidden>
      <div class="panel-toolbar">
        <span class="panel-note" id="keywords-meta">加载中…</span>
        <input type="search" id="keywords-search" placeholder="搜词" aria-label="搜索词库规则" />
      </div>
      <div class="pack-list" id="keywords-list"></div>
    </section>

    <section class="panel" id="panel-ranked" role="tabpanel" hidden>
      <div class="panel-toolbar">
        <span class="pill" id="ranked-season"></span>
        <span class="panel-note dim" id="ranked-updated"></span>
      </div>
      <div class="ranked-tabs">
        <button type="button" class="ranked-tab is-active" id="ranked-tab-week" aria-pressed="true">周榜</button>
        <button type="button" class="ranked-tab" id="ranked-tab-all" aria-pressed="false">总榜</button>
      </div>
      <div class="ranked-list" id="ranked-list"><p class="empty">载入中…</p></div>
      <p class="ranked-rule" id="ranked-foot">确认击杀 +1 · 首杀 +1 · 误伤 −2 · 周一开榜</p>
    </section>
  </main>

  <footer>
    <span><a href="/">首页</a></span>
    <span>福滤娃 FeedSieve</span>
    <span>MIT · 开源</span>
  </footer>

  <!-- 申请弹窗：白名单自荐 / 误伤申诉共用，两步（提交 → 邮箱验证码） -->
  <dialog class="apply-dialog" id="apply-dialog">
    <div class="dialog-head">
      <h3 id="apply-dialog-title">提交申请</h3>
      <button class="icon-btn" id="close-apply" type="button" aria-label="关闭">×</button>
    </div>

    <form id="apply-form" class="apply-body">
      <div class="kind-row" role="radiogroup" aria-label="申请类型">
        <label class="kind-card">
          <input type="radio" name="kind" value="whitelist" checked />
          <span class="kind-title">进白名单</span>
          <span class="kind-desc">博主宣言，公示展示</span>
        </label>
        <label class="kind-card">
          <input type="radio" name="kind" value="appeal" />
          <span class="kind-title">申诉误伤</span>
          <span class="kind-desc">公示条目有误，请复核</span>
        </label>
      </div>
      <input type="text" id="apply-handle" placeholder="@账号" maxlength="16" autocomplete="off" />
      <input type="email" id="apply-email" placeholder="邮箱（用于验证）" autocomplete="email" />
      <textarea id="apply-statement" rows="4" maxlength="500" placeholder="宣言或申诉理由（8–500 字）"></textarea>
      <button type="submit" class="btn-primary wide">提交</button>
      <p class="form-msg" id="apply-msg" role="status"></p>
    </form>

    <form id="verify-form" class="apply-body" hidden>
      <p class="form-msg" id="verify-hint"></p>
      <div class="verify-row">
        <input type="text" id="verify-code" placeholder="6 位验证码" inputmode="numeric" maxlength="6" autocomplete="one-time-code" />
        <button type="submit" class="btn-primary">验证</button>
      </div>
      <p class="form-msg" id="verify-msg" role="status"></p>
    </form>
  </dialog>

  <script>
    (function () {
      var API_BASE = '';
      var CATEGORY_LABELS = {
        bot_spam: '机器人', copy_paste: '重复刷屏', ai_slop: 'AI 垃圾',
        advertising: '广告号', adult_gray_traffic: '色情引流',
        scam_phishing: '诈骗', engagement_bait: '互动钓鱼', other: '垃圾账号',
      };
      var ERROR_TEXT = {
        invalid_handle: '账号名不合法',
        invalid_email: '邮箱不合法',
        invalid_statement: '陈述需 8–500 字',
        too_many_submissions: '今日提交次数已达上限',
        too_many_code_requests: '验证码发送太频繁，1 小时后再试',
        too_many_attempts: '错码次数过多，请重新提交',
        invalid_or_expired_code: '验证码错误或已过期',
        application_pending: '该账号已有申请在处理中',
        application_not_found: '没有待验证的申请',
        mail_unconfigured: '邮件通道未配置，暂无法提交',
        network: '网络错误，稍后再试',
      };
      function errorText(code) { return ERROR_TEXT[code] || ('提交失败（' + code + '）'); }

      function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
      }

      function handleLink(handle) {
        var link = el('a', 'handle', '@' + handle);
        link.href = 'https://x.com/' + encodeURIComponent(handle);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
      }

      function fmtDate(iso) { return iso ? iso.slice(0, 10) : '—'; }

      function setCount(id, n) {
        var node = document.getElementById(id);
        if (node) node.textContent = n > 0 ? ' ' + n : '';
      }

      function showMsg(id, text, isError) {
        var node = document.getElementById(id);
        node.textContent = text;
        node.classList.toggle('error', Boolean(isError));
      }

      /* --- Tab 切换（hash 路由） --- */
      var TABS = ['blacklist', 'whitelist', 'keywords', 'ranked'];
      function showTab(name) {
        if (TABS.indexOf(name) === -1) name = 'blacklist';
        var buttons = document.querySelectorAll('.tab');
        for (var i = 0; i < buttons.length; i++) {
          buttons[i].classList.toggle('active', buttons[i].getAttribute('data-tab') === name);
        }
        for (var j = 0; j < TABS.length; j++) {
          document.getElementById('panel-' + TABS[j]).hidden = TABS[j] !== name;
        }
        if (name === 'ranked') scheduleRankedRefresh();
        if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
      }
      var tabButtons = document.querySelectorAll('.tab');
      for (var t = 0; t < tabButtons.length; t++) {
        tabButtons[t].addEventListener('click', function () {
          showTab(this.getAttribute('data-tab'));
        });
      }
      window.addEventListener('hashchange', function () {
        var name = location.hash.slice(1);
        if (name === 'apply') { openApply(); showTab('blacklist'); return; }
        showTab(name);
      });

      /* --- 申请弹窗 --- */
      var dialog = document.getElementById('apply-dialog');
      function openApply() {
        showMsg('apply-msg', '', false);
        dialog.showModal();
      }
      document.getElementById('open-apply').addEventListener('click', openApply);
      document.getElementById('close-apply').addEventListener('click', function () {
        dialog.close();
      });
      dialog.addEventListener('click', function (event) {
        // 点遮罩（dialog 自身）关闭；点表单内容不关
        if (event.target === dialog) dialog.close();
      });

      /* --- 黑名单 / 白名单 / 抢救渲染 --- */
      var blacklistEntries = [];
      var blacklistShowAll = false;
      var BLACKLIST_PAGE = 100; // 默认渲染前 100 条，移动端不撑爆 DOM；搜索时全量
      var openedDetails = {}; // handle → 详情行展开状态
      function detailRow(entry) {
        var tr = el('tr', 'detail-row');
        var td = el('td', 'detail-cell');
        td.colSpan = 7;
        if (entry.maintainer_note) {
          var noteRow = el('div', 'detail-line');
          noteRow.appendChild(el('span', 'detail-label', '维护者'));
          noteRow.appendChild(el('span', null, entry.maintainer_note));
          td.appendChild(noteRow);
        }
        if (entry.evidence_post_ids && entry.evidence_post_ids.length) {
          var evl = el('div', 'detail-line');
          evl.appendChild(el('span', 'detail-label', '证据帖'));
          var evLinks = el('span', 'detail-values');
          for (var i = 0; i < entry.evidence_post_ids.length; i++) {
            var a = el('a', 'detail-link', entry.evidence_post_ids[i]);
            a.href = 'https://x.com/i/web/status/' + encodeURIComponent(entry.evidence_post_ids[i]);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            evLinks.appendChild(a);
          }
          evl.appendChild(evLinks);
          td.appendChild(evl);
        }
        if (entry.domains && entry.domains.length) {
          var dl = el('div', 'detail-line');
          dl.appendChild(el('span', 'detail-label', '外链'));
          var dv = el('span', null, entry.domains.join(' · '));
          dv.className = 'detail-values';
          dl.appendChild(dv);
          td.appendChild(dl);
        }
        if (entry.aliases && entry.aliases.length) {
          var al = el('div', 'detail-line');
          al.appendChild(el('span', 'detail-label', '历史名'));
          al.appendChild(el('span', 'detail-values', entry.aliases.join(' · ')));
          td.appendChild(al);
        }
        tr.appendChild(td);
        return tr;
      }

      function renderBlacklist() {
        var tbody = document.querySelector('#blacklist-table tbody');
        tbody.textContent = '';
        var query = document.getElementById('blacklist-search').value.trim().toLowerCase().replace(/^@/, '');
        var total = blacklistEntries.length;
        var limit = (showAllBlacklist() || query) ? total : BLACKLIST_PAGE;
        var shown = 0;
        blacklistEntries.sort(function (a, b) { return b.net_votes - a.net_votes; });
        for (var i = 0; i < blacklistEntries.length && shown < limit; i++) {
          var entry = blacklistEntries[i];
          if (query && entry.handle.indexOf(query) === -1) continue;
          shown++;
          var tr = el('tr', 'main-row');
          var tdHandle = el('td');
          tdHandle.appendChild(handleLink(entry.handle));
          tr.appendChild(tdHandle);
          tr.appendChild(el('td', 'muted', CATEGORY_LABELS[entry.category] || entry.category));
          var tdSource = el('td');
          for (var s = 0; s < entry.sources.length; s++) {
            tdSource.appendChild(el('span', 'src', entry.sources[s] === 'maintainer' ? '维护者' : '社区'));
          }
          tr.appendChild(tdSource);
          tr.appendChild(el('td', 'num', String(entry.report_count)));
          tr.appendChild(el('td', 'num', String(entry.rescue_count)));
          tr.appendChild(el('td', 'num votes', String(entry.net_votes)));
          tr.appendChild(el('td', 'muted', fmtDate(entry.updated_at)));
          tbody.appendChild(tr);
          var expandable =
            entry.maintainer_note ||
            (entry.evidence_post_ids && entry.evidence_post_ids.length) ||
            (entry.domains && entry.domains.length) ||
            (entry.aliases && entry.aliases.length);
          if (expandable && openedDetails[entry.handle]) tbody.appendChild(detailRow(entry));
        }
        document.getElementById('blacklist-empty').hidden = shown > 0;
        var note = document.getElementById('blacklist-note');
        note.hidden = !(query && shown > 0);
        note.textContent = '匹配 ' + shown + ' 条';
        var more = document.getElementById('blacklist-more');
        more.hidden = !(shown < total && !query);
        more.textContent = shown < total && !query ? '显示全部 ' + total + ' 条' : '';
      }
      function showAllBlacklist() { return blacklistShowAll; }
      document.getElementById('blacklist-more').addEventListener('click', function () {
        blacklistShowAll = true;
        renderBlacklist();
      });
      document.querySelector('#blacklist-table').addEventListener('click', function (event) {
        var row = event.target.closest('tr.main-row');
        if (!row) return;
        var handle = row.querySelector('a.handle');
        if (!handle) return;
        // 点击行内链接不触发展开
        if (event.target !== handle && handle.contains(event.target)) return;
        openedDetails[handle.textContent.slice(1)] = !openedDetails[handle.textContent.slice(1)];
        renderBlacklist();
      });

      function renderWhitelist(entries) {
        var tbody = document.querySelector('#whitelist-table tbody');
        tbody.textContent = '';
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var tr = el('tr');
          var tdHandle = el('td');
          tdHandle.appendChild(handleLink(entry.handle));
          tr.appendChild(tdHandle);
          tr.appendChild(el('td', 'wrap', entry.note || '—'));
          tr.appendChild(el('td', 'muted', fmtDate(entry.added_at)));
          tbody.appendChild(tr);
        }
        document.getElementById('whitelist-empty').hidden = entries.length > 0;
      }

      function renderVerified(entries) {
        var tbody = document.querySelector('#verified-table tbody');
        tbody.textContent = '';
        entries.sort(function (a, b) { return b.net_votes - a.net_votes; });
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var tr = el('tr');
          var tdHandle = el('td');
          tdHandle.appendChild(handleLink(entry.handle));
          tr.appendChild(tdHandle);
          tr.appendChild(el('td', 'num', String(entry.rescue_count)));
          tr.appendChild(el('td', 'num', String(entry.report_count)));
          tr.appendChild(el('td', 'num votes', String(entry.net_votes)));
          tr.appendChild(el('td', 'muted', fmtDate(entry.updated_at)));
          tbody.appendChild(tr);
        }
        document.getElementById('verified-empty').hidden = entries.length > 0;
      }

      fetch(API_BASE + '/v1/roster/latest')
        .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
        .then(function (data) {
          var meta = document.getElementById('roster-meta');
          meta.textContent = '';
          meta.appendChild(el('span', null, '快照 ' + data.snapshot_version + ' · ' + fmtDate(data.generated_at)));
          meta.appendChild(el('span', data.signed ? 'sig ok' : 'sig', data.signed ? '已签名' : '未签名'));
          document.getElementById('stat-blacklist').textContent = data.blacklist.count;
          document.getElementById('stat-version').textContent = data.snapshot_version;
          setCount('blacklist-count', data.blacklist.count);
          setCount('whitelist-count', data.whitelist.maintained.length);
          blacklistEntries = data.blacklist.entries;
          renderBlacklist();
          renderWhitelist(data.whitelist.maintained);
          renderVerified(data.whitelist.verified);
          document.getElementById('blacklist-search').addEventListener('input', renderBlacklist);
        })
        .catch(function (error) {
          var meta = document.getElementById('roster-meta');
          meta.textContent = '名单加载失败：' + (ERROR_TEXT[error.message] || error.message);
          meta.classList.add('error');
        });

      /* --- 词库（黄框规则全量公示：packVersion manifest → 版本化文件） --- */
      var keywordPacks = [];
      function renderKeywords() {
        var list = document.getElementById('keywords-list');
        list.textContent = '';
        var query = document.getElementById('keywords-search').value.trim().toLowerCase();
        var matchedRules = 0;
        for (var i = 0; i < keywordPacks.length; i++) {
          var pack = keywordPacks[i];
          var phrases = [];
          var rules = pack.rules || [];
          for (var r = 0; r < rules.length; r++) {
            var phrase = (rules[r].phrase || rules[r].id || '');
            if (query && phrase.toLowerCase().indexOf(query) === -1) continue;
            phrases.push(phrase);
          }
          if (query && phrases.length === 0) continue;
          var card = el('div', 'pack-card');
          var head = el('button', 'pack-head');
          head.type = 'button';
          head.appendChild(el('span', 'pack-name', pack.name && pack.name.zh ? pack.name.zh : pack.id));
          head.appendChild(el('span', 'pack-count', phrases.length ? phrases.length + ' 条' : (rules.length + ' 条')));
          head.appendChild(el('span', 'pack-arrow', '▾'));
          card.appendChild(head);
          var bodyWrap = el('div', 'pack-rules');
          bodyWrap.hidden = true;
          var flow = el('div', 'pill-flow');
          for (var p = 0; p < phrases.length; p++) flow.appendChild(el('span', 'kw', phrases[p]));
          bodyWrap.appendChild(flow);
          card.appendChild(bodyWrap);
          if (query) bodyWrap.hidden = false; // 搜索命中自动展开
          head.addEventListener('click', function () {
            var b = this.nextElementSibling;
            b.hidden = !b.hidden;
            this.classList.toggle('open', !b.hidden);
          });
          list.appendChild(card);
        }
        setKeywordsNote();
      }
      function setKeywordsNote() {
        var note = document.getElementById('keywords-meta');
        var query = document.getElementById('keywords-search').value.trim().toLowerCase();
        var all = document.querySelectorAll('#keywords-list .kw');
        if (query) {
          note.textContent = '匹配 ' + all.length + ' 条';
        } else {
          note.textContent = document.getElementById('keywords-list').dataset.notes || '';
        }
      }
      fetch(API_BASE + '/v1/keyword-packs/latest')
        .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
        .then(function (manifest) {
          var first = manifest.files && manifest.files[0];
          var version = manifest.pack_version;
          var stats = first ? first.packs + ' 组 · ' + first.rules + ' 条' : '';
          document.getElementById('keywords-list').dataset.notes =
            '词库 ' + version + ' · ' + stats + (manifest.signature ? ' · 已签名' : '');
          document.getElementById('keywords-meta').textContent = '加载中…';
          return fetch(API_BASE + '/v1/keyword-packs/' + encodeURIComponent(version) + '/official.json');
        })
        .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
        .then(function (data) {
          (data.packs || []).sort(function (a, b) { return (b.rules || []).length - (a.rules || []).length; });
          keywordPacks = data.packs || [];
          var totalRules = 0;
          for (var i = 0; i < keywordPacks.length; i++) totalRules += (keywordPacks[i].rules || []).length;
          document.getElementById('keywords-list').dataset.totalRules = totalRules;
          setCount('keywords-count', totalRules);
          setKeywordsNote();
          renderKeywords();
          document.getElementById('keywords-search').addEventListener('input', renderKeywords);
        })
        .catch(function () {
          document.getElementById('keywords-meta').textContent = '词库加载失败';
        });

      /* 排位赛榜单（周榜 / 总榜切换，切到该 Tab 时加载/刷新） --- */
      var rankedLoaded = false;
      var rankedScope = 'week';
      function huluBadge(rank) {
        if (rank <= 7) return ['大娃','二娃','三娃','四娃','五娃','六娃','七娃'][rank - 1];
        if (rank <= 50) return '小金刚';
        return '';
      }
      function renderRanked(data) {
        var isAllScope = rankedScope === 'all';
        var seasonEl = document.getElementById('ranked-season');
        var updatedEl = document.getElementById('ranked-updated');
        var list = document.getElementById('ranked-list');
        if (isAllScope || !data.season) {
          seasonEl.textContent = '累计总分 · 一人一娃';
        } else {
          var days = Math.max(0, Math.ceil((data.season.ends_at - data.updated_at) / 86400));
          seasonEl.textContent = '第 ' + (data.season.id % 100) + ' 周 · 剩 ' + days + ' 天';
        }
        if (data.updated_at) {
          updatedEl.textContent = '更新于 ' + new Date(data.updated_at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        list.textContent = '';
        if (!data.rows.length) {
          list.appendChild(el('p', 'empty', isAllScope ? '总榜还没有人' : '本周还没有人开火'));
        }
        for (var i = 0; i < data.rows.length; i++) {
          var row = data.rows[i];
          var item = el('div', 'ranked-row' + (row.rank === 1 ? ' first' : ''));
          if (row.rank === 1) item.appendChild(el('span', 'glow'));
          item.appendChild(el('span', 'ranked-rank', String(row.rank)));
          var who = el('div', 'ranked-who');
          var name = el('div', 'ranked-name');
          var badge = isAllScope ? huluBadge(row.rank) : '';
          if (badge) name.appendChild(el('span', 'ranked-hulu' + (row.rank > 7 ? ' mid' : ''), badge));
          if (row.title) name.appendChild(el('span', 'ranked-title', '◆ ' + row.title));
          if (row.tier) name.appendChild(el('span', 'ranked-tier', row.tier));
          name.appendChild(el('span', null, row.name));
          who.appendChild(name);
          var meta = el('div', 'ranked-meta');
          if (row.bio) meta.appendChild(el('span', 'ranked-bio', row.bio));
          if (row.x_handle) {
            var handle = el('a', 'ranked-handle', '@' + row.x_handle);
            handle.href = 'https://x.com/' + encodeURIComponent(row.x_handle);
            handle.target = '_blank';
            handle.rel = 'noopener noreferrer';
            meta.appendChild(handle);
          }
          if (meta.childNodes.length) who.appendChild(meta);
          var stats = el('div', 'ranked-stats');
          stats.appendChild(el('span', 'ranked-kills', row.kills + ' 只野'));
          stats.appendChild(el('span', 'ranked-accuracy', Math.round(row.accuracy * 100) + '%'));
          item.appendChild(stats);
          list.appendChild(item);
        }
        var foot = document.getElementById('ranked-foot');
        if (!isAllScope && data.last_season && data.last_season.champions && data.last_season.champions.length) {
          var names = data.last_season.champions.map(function (c) { return c.name; }).join('、');
          foot.textContent = '上届冠军 ' + names + ' · 第 ' + (data.last_season.id % 100) + ' 周';
        } else {
          foot.textContent = '确认击杀 +1 · 首杀 +1 · 误伤 −2 · 周一开榜';
        }
      }
      function setRankedScope(value) {
        if (rankedScope === value) return;
        rankedScope = value;
        var week = document.getElementById('ranked-tab-week');
        var all = document.getElementById('ranked-tab-all');
        week.classList.toggle('is-active', value === 'week');
        week.setAttribute('aria-pressed', value === 'week' ? 'true' : 'false');
        all.classList.toggle('is-active', value === 'all');
        all.setAttribute('aria-pressed', value === 'all' ? 'true' : 'false');
        loadRanked();
      }
      document.getElementById('ranked-tab-week').addEventListener('click', function () { setRankedScope('week'); });
      document.getElementById('ranked-tab-all').addEventListener('click', function () { setRankedScope('all'); });
      function loadRanked() {
        fetch(API_BASE + '/v1/leaderboard', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: rankedScope }),
        })
          .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
          .then(function (data) {
            rankedLoaded = true;
            renderRanked(data);
          })
          .catch(function () {
            if (!rankedLoaded) {
              var list = document.getElementById('ranked-list');
              list.textContent = '';
              list.appendChild(el('p', 'empty', '榜单加载失败'));
            }
          });
      }
      /* 停留榜单 Tab 时 30 秒静默刷新一次（与 API 域周榜页同节奏） */
      var rankedTimer = null;
      function scheduleRankedRefresh() {
        loadRanked();
        clearTimeout(rankedTimer);
        rankedTimer = setTimeout(loadRanked, 30000);
      }
      var initialTab = location.hash.slice(1);
      showTab(initialTab || 'blacklist');
      // 直接访问 /lists#apply：初始加载不触发 hashchange，这里补一次弹窗直达
      // （showTab 内部的 replaceState 会把 hash 覆写为 Tab 名，必须先取值再判断）
      if (initialTab === 'apply') openApply();

      /* --- 申请表单（两步：提交 → 邮箱验证码） --- */
      document.getElementById('apply-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var payload = {
          handle: document.getElementById('apply-handle').value,
          email: document.getElementById('apply-email').value,
          kind: document.querySelector('input[name="kind"]:checked').value,
          statement: document.getElementById('apply-statement').value,
        };
        showMsg('apply-msg', '提交中…', false);
        fetch(API_BASE + '/v1/applications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(async function (res) {
            var body = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(body.error || 'network');
            if (body.dev_code) document.getElementById('verify-code').value = body.dev_code;
            document.getElementById('verify-hint').textContent = '验证码已发送到 ' + payload.email;
            showMsg('apply-msg', '', false);
            document.getElementById('apply-form').hidden = true;
            document.getElementById('verify-form').hidden = false;
            document.getElementById('verify-code').focus();
          })
          .catch(function (error) {
            showMsg('apply-msg', errorText(error.message), true);
          });
      });

      document.getElementById('verify-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var email = document.getElementById('apply-email').value;
        var code = document.getElementById('verify-code').value;
        showMsg('verify-msg', '验证中…', false);
        fetch(API_BASE + '/v1/applications/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email, code: code }),
        })
          .then(async function (res) {
            var body = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(body.error || 'network');
            showMsg('apply-msg', '已进入处理队列。', false);
            document.getElementById('verify-form').hidden = true;
            document.getElementById('apply-form').hidden = false;
          })
          .catch(function (error) {
            showMsg('verify-msg', errorText(error.message), true);
          });
      });
    })();
  </script>
</body>
</html>
`;
}
