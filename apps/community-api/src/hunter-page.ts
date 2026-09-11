/**
 * 打野榜公开页：纯静态单文件（无框架、无外链资源），数据走
 * POST /v1/leaderboard（scope=week｜all）。?me= 的高亮标识由扩展跳转携带，
 * 页面拿到后立即从地址栏抹除；编辑凭证 token 存 localStorage，凭它改档案。
 * 周榜 30 秒静默轮询；总榜按需加载；认领/登录/编辑全部在页面内闭环。
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function hunterPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>打野 · FeedSieve</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 64px;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: light-dark(#fafafa, #14171a); color: light-dark(#1a1a1a, #e7e9ea);
  }
  main { max-width: 640px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
  h1 { font-size: 20px; margin: 0; font-weight: 700; }
  .brand { color: light-dark(#737373, #8b98a5); font-size: 13px; margin-right: 6px; }
  .season { color: light-dark(#737373, #8b98a5); font-size: 13px; white-space: nowrap; }
  .tabs { display: flex; gap: 8px; margin-bottom: 12px; }
  .tabs button {
    padding: 5px 14px; border-radius: 999px; border: 1px solid light-dark(#e5e5e5, #2f3336);
    background: none; color: light-dark(#737373, #8b98a5); font: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer;
  }
  .tabs button.is-active { background: light-dark(#fff8e1, #24211a); color: #b8860b; border-color: currentColor; }
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-bottom: 1px solid light-dark(#ececec, #2f3336);
  }
  .row.me { background: light-dark(#fff8e1, #24211a); border-radius: 8px; border-bottom-color: transparent; }
  .rank { width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: light-dark(#737373, #8b98a5); flex-shrink: 0; }
  .rank.top1 { color: #d4a017; font-weight: 800; }
  .rank.top2 { color: #9aa0a6; font-weight: 800; }
  .rank.top3 { color: #b87333; font-weight: 800; }
  .hulu { font-weight: 600; margin-right: 5px; color: #d4a017; }
  .hulu.mid { color: light-dark(#737373, #8b98a5); }
  .who { flex: 1; min-width: 0; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title { color: #b8860b; font-weight: 600; margin-right: 6px; }
  .tier { color: light-dark(#737373, #8b98a5); font-weight: 600; margin-right: 4px; }
  .handle { color: #1d9bf0; font-size: 12.5px; text-decoration: none; margin-left: 4px; }
  .handle:hover { text-decoration: underline; }
  .bio { color: light-dark(#737373, #8b98a5); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stats { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .kills { font-weight: 700; }
  .accuracy { color: light-dark(#737373, #8b98a5); font-size: 12.5px; margin-left: 6px; }
  .beaten { color: light-dark(#737373, #8b98a5); font-size: 12px; margin-left: 6px; }
  .empty { text-align: center; color: light-dark(#737373, #8b98a5); padding: 48px 0; }
  .claim {
    margin-top: 20px; padding: 14px 16px; border: 1px solid light-dark(#ececec, #2f3336);
    border-radius: 10px;
  }
  .claim h2 { margin: 0 0 4px; font-size: 14px; font-weight: 700; }
  .claim .hint { color: light-dark(#737373, #8b98a5); font-size: 12.5px; margin: 0 0 10px; }
  .claim .fields { display: flex; gap: 8px; flex-wrap: wrap; }
  .claim input {
    flex: 1 1 220px; min-width: 0; padding: 8px 10px;
    border: 1px solid light-dark(#e5e5e5, #2f3336); border-radius: 8px;
    background: none; color: inherit; font: inherit;
  }
  .claim button {
    padding: 8px 16px; border: 0; border-radius: 8px; background: #d4a017; color: #fff;
    font: inherit; font-weight: 650; cursor: pointer;
  }
  .claim button:disabled { opacity: 0.5; cursor: default; }
  .claim .profile .fields { flex-direction: column; }
  .claim .profile input { width: 100%; flex: none; }
  .msg { font-size: 12.5px; margin: 8px 0 0; color: light-dark(#737373, #8b98a5); }
  .msg-ok { color: #1a7f37 !important; } .msg-err { color: #c0392b !important; }
  .profile { margin-top: 10px; display: none; }
  footer { margin-top: 24px; color: light-dark(#737373, #8b98a5); font-size: 12.5px; }
</style>
</head>
<body>
<main>
  <header>
    <h1><span class="brand">福滤娃</span>打野榜</h1>
    <span class="season" id="season"></span>
  </header>
  <div class="tabs">
    <button type="button" id="tab-week" class="is-active">周榜</button>
    <button type="button" id="tab-all">总榜</button>
  </div>
  <div id="board"><div class="empty">载入中…</div></div>

  <div class="claim">
    <h2>认领我的猎手档</h2>
    <p class="hint">先在扩展弹窗「猎手」里绑定过邮箱，这里用验证码登录后即可改昵称 / 简介 / X 账号。</p>
    <div class="fields" id="claim-step-email">
      <input type="email" id="claim-email" placeholder="邮箱" autocomplete="email">
      <button type="button" id="claim-send">领取验证码</button>
    </div>
    <div class="fields" id="claim-step-code" style="display:none">
      <input type="text" id="claim-code" placeholder="6 位验证码" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      <button type="button" id="claim-login">登录</button>
    </div>
    <div class="profile" id="profile">
      <div class="fields">
        <input type="text" id="pf-name" maxlength="16" placeholder="昵称（≤16 字）">
        <input type="text" id="pf-bio" maxlength="60" placeholder="一句话介绍（≤60 字）">
        <input type="text" id="pf-handle" maxlength="15" placeholder="X 账号（不带 @）">
        <button type="button" id="pf-save">保存</button>
      </div>
    </div>
    <p class="msg" id="claim-msg"></p>
  </div>

  <footer id="foot">确认击杀 +1 · 首杀 +1 · 误伤 −2 · 周一开榜</footer>
</main>
<script>
  var me = new URLSearchParams(location.search).get('me');
  if (me) history.replaceState(null, '', location.pathname);
  var TOKEN_KEY = 'fs_hunt_token';
  var scope = 'week';
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var pendingEmail = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function hulu(rank) {
    if (rank <= 7) return ['大娃','二娃','三娃','四娃','五娃','六娃','七娃'][rank - 1];
    if (rank <= 50) return '小金刚';
    return '';
  }

  function switchTab(value) {
    if (scope === value) return;
    scope = value;
    document.getElementById('tab-week').classList.toggle('is-active', value === 'week');
    document.getElementById('tab-all').classList.toggle('is-active', value === 'all');
    document.getElementById('board').innerHTML = '<div class="empty">载入中…</div>';
    refresh();
  }

  function render(data) {
    var isAllScope = scope === 'all';
    var rows = data.rows || [];
    var total = data.total || rows.length;
    var seasonEl = document.getElementById('season');
    if (!isAllScope && data.season) {
      var days = Math.max(0, Math.ceil((data.season.ends_at - data.updated_at) / 86400));
      seasonEl.textContent = '第 ' + (data.season.id % 100) + ' 周 · 剩 ' + days + ' 天';
    } else if (isAllScope) {
      seasonEl.textContent = '累计总分 · 一人一娃';
    }

    var merged = [];
    for (var i = 0; i < rows.length; i++) {
      var copy = {};
      for (var key in rows[i]) copy[key] = rows[i][key];
      copy.rank = rows[i].rank || i + 1;
      if (data.me && rows[i].id === data.me.id) {
        copy.is_me = true;
        copy.beaten = data.me.rank && total > 0
          ? Math.max(0, Math.round((1 - data.me.rank / total) * 100)) : null;
      }
      merged.push(copy);
    }
    if (!merged.length) {
      document.getElementById('board').innerHTML = '<div class="empty">'
        + (isAllScope ? '总榜还没有人' : '本周还没有人开火') + '</div>';
      return;
    }
    // 我的行超出 TopN 时单独补一行
    if (data.me && (data.me.rank == null || data.me.rank > merged.length)) {
      var mine = {};
      for (var meKey in data.me) mine[meKey] = data.me[meKey];
      mine.is_me = true;
      if (mine.beaten == null) {
        mine.beaten = data.me.rank && total > 0
          ? Math.max(0, Math.round((1 - data.me.rank / total) * 100)) : null;
      }
      merged.push(mine);
    }
    document.getElementById('board').innerHTML = boardHtml(merged, isAllScope);
  }

  function boardHtml(rows, isAllScope) {
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var badge = isAllScope ? hulu(row.rank) : '';
      var rankCls = 'rank' + (row.rank === 1 ? ' top1' : row.rank === 2 ? ' top2' : row.rank === 3 ? ' top3' : '');
      html += '<div class="row' + (row.is_me ? ' me' : '') + '">'
        + '<span class="' + rankCls + '">' + row.rank + '</span>'
        + '<span class="who"><span class="name">'
        + (badge ? '<span class="hulu' + (row.rank > 7 ? ' mid' : '') + '">' + esc(badge) + '</span>' : '')
        + (row.title ? '<span class="title">◆ ' + esc(row.title) + '</span>' : '')
        + (row.tier ? '<span class="tier">' + esc(row.tier) + '</span>' : '')
        + esc(row.name) + '</span>'
        + (row.x_handle ? '<a class="handle" href="https://x.com/' + encodeURIComponent(row.x_handle)
          + '" rel="noopener noreferrer" target="_blank">@' + esc(row.x_handle) + '</a>' : '')
        + (row.bio ? '<div class="bio">' + esc(row.bio) + '</div>' : '')
        + '</span>'
        + '<span class="stats"><span class="kills">' + row.kills + ' 只野</span>'
        + '<span class="accuracy">' + Math.round(row.accuracy * 100) + '%</span>'
        + (row.is_me && row.beaten != null ? '<span class="beaten">打败 ' + row.beaten + '%</span>' : '')
        + '</span>'
        + '</div>';
    }
    return html;
  }

  function refresh() {
    // 无 me：GET 边缘缓存端点（热点流量不产生 D1 查询）；带 me：POST 定位
    var url = '/v1/leaderboard' + (me ? '' : '?scope=' + scope);
    var options = me
      ? { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope: scope, me: me }) }
      : { headers: { accept: 'application/json' } };
    fetch(url, options)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) render(data); })
      .catch(function () {});
  }

  document.getElementById('tab-week').addEventListener('click', function () { switchTab('week'); });
  document.getElementById('tab-all').addEventListener('click', function () { switchTab('all'); });
  setInterval(function () { if (!document.hidden && scope === 'week') refresh(); }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && scope === 'week') refresh();
  });
  refresh();

  // ---- 认领 / 登录 / 编辑 ----
  var msgEl = document.getElementById('claim-msg');
  function setMsg(text, kind) {
    msgEl.textContent = text;
    msgEl.setAttribute('class',
      'msg' + (kind === 'ok' ? ' msg-ok' : kind === 'err' ? ' msg-err' : ''));
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (json) { return { status: res.status, json: json }; });
    });
  }
  document.getElementById('claim-send').addEventListener('click', function () {
    var email = document.getElementById('claim-email').value.trim();
    if (!email) return;
    setMsg('发送中…', '');
    post('/v1/player/page-code', { email: email }).then(function (result) {
      if (result.status === 200) {
        pendingEmail = email;
        document.getElementById('claim-step-email').style.display = 'none';
        document.getElementById('claim-step-code').style.display = '';
        if (result.json.dev_code) document.getElementById('claim-code').value = result.json.dev_code;
        setMsg('验证码已发到 ' + esc(email), 'ok');
      } else if (result.json.error === 'not_bound') {
        setMsg('这个邮箱还没绑定过猎手账号：先在扩展弹窗「打野 → 猎手」完成一次邮箱验证，再回来认领。', 'err');
      } else if (result.json.error === 'too_many_code_requests') {
        setMsg('发码太频繁，一小时后再试', 'err');
      } else if (result.status === 400) {
        setMsg('邮箱格式不对', 'err');
      } else {
        setMsg('发送失败，稍后再试', 'err');
      }
    }).catch(function () { setMsg('网络异常，稍后再试', 'err'); });
  });
  document.getElementById('claim-login').addEventListener('click', function () {
    var code = document.getElementById('claim-code').value.trim();
    if (!pendingEmail || code.length !== 6) { setMsg('先取码、再填 6 位验证码', 'err'); return; }
    post('/v1/player/page-login', { email: pendingEmail, code: code }).then(function (result) {
      if (result.status === 200 && result.json.token) {
        token = result.json.token;
        try { localStorage.setItem(TOKEN_KEY, token); } catch (storageError) {}
        hydrateProfile(result.json);
        setMsg('已登录，改完点「保存」即可上新榜', 'ok');
      } else if (result.json.error === 'not_bound') {
        setMsg('这个邮箱还没绑定过猎手账号', 'err');
      } else if (result.json.error === 'too_many_attempts') {
        setMsg('错码次数过多，请重新领码', 'err');
      } else {
        setMsg('验证码不对或已过期', 'err');
      }
    }).catch(function () { setMsg('网络异常，稍后再试', 'err'); });
  });
  function hydrateProfile(profileValue) {
    document.getElementById('pf-name').value = profileValue.display_name || '';
    document.getElementById('pf-bio').value = profileValue.bio || '';
    document.getElementById('pf-handle').value = profileValue.x_handle || '';
    document.getElementById('profile').style.display = 'block';
  }
  document.getElementById('pf-save').addEventListener('click', function () {
    if (!token) return;
    post('/v1/player/profile', {
      token: token,
      display_name: document.getElementById('pf-name').value.trim(),
      bio: document.getElementById('pf-bio').value.trim(),
      x_handle: document.getElementById('pf-handle').value.trim().replace(/^@+/, ''),
    }).then(function (result) {
      if (result.status === 200) {
        setMsg('已保存，榜单稍候更新', 'ok');
      } else if (result.json.error === 'invalid_x_handle') {
        setMsg('X 账号格式不对（1-15 位字母数字下划线）', 'err');
      } else if (result.json.error === 'invalid_bio') {
        setMsg('简介太长', 'err');
      } else if (result.status === 403) {
        document.getElementById('profile').style.display = 'none';
        setMsg('登录已过期，请重新认领', 'err');
      } else {
        setMsg('保存失败，稍后再试', 'err');
      }
    }).catch(function () { setMsg('网络异常，稍后再试', 'err'); });
  });

  // 回访自动登录：先校验本地 token，有效则展开档案区
  if (token) {
    post('/v1/player/me', { token: token }).then(function (result) {
      if (result.status === 200) {
        hydrateProfile(result.json);
        setMsg('已登录', 'ok');
      } else {
        token = '';
        try { localStorage.removeItem(TOKEN_KEY); } catch (storageError) {}
      }
    }).catch(function () {});
  }
</script>
</body>
</html>`;
}

export { escapeHtml };
