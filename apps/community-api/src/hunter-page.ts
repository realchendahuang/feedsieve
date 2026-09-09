/**
 * 打野周榜公开页：纯静态单文件（无框架、无外链资源），数据走
 * POST /v1/leaderboard（?me= 的高亮标识由扩展跳转携带，页面拿到后立即
 * 从地址栏抹除，用户复制/分享出去的是干净 URL）。30 秒静默轮询 +
 * 切回标签页即刷，玩家视角即实时。
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
<title>打野周榜 · FeedSieve</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: light-dark(#fafafa, #14171a); color: light-dark(#1a1a1a, #e7e9ea);
  }
  main { max-width: 640px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0; font-weight: 700; }
  .season { color: light-dark(#737373, #8b98a5); font-size: 13px; }
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px; border-bottom: 1px solid light-dark(#ececec, #2f3336);
  }
  .row.me { background: light-dark(#fff8e1, #24211a); border-radius: 8px; border-bottom-color: transparent; }
  .rank { width: 32px; text-align: right; font-variant-numeric: tabular-nums; color: light-dark(#737373, #8b98a5); }
  .who { flex: 1; min-width: 0; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title { color: #b8860b; font-weight: 600; margin-right: 6px; }
  .bio { color: light-dark(#737373, #8b98a5); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stats { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .kills { font-weight: 700; }
  .accuracy { color: light-dark(#737373, #8b98a5); font-size: 12.5px; margin-left: 6px; }
  .empty { text-align: center; color: light-dark(#737373, #8b98a5); padding: 48px 0; }
  footer { margin-top: 24px; color: light-dark(#737373, #8b98a5); font-size: 12.5px; }
  .error { text-align: center; padding: 48px 0; color: light-dark(#737373, #8b98a5); }
</style>
</head>
<body>
<main>
  <header>
    <h1>打野周榜</h1>
    <span class="season" id="season"></span>
  </header>
  <div id="board"><div class="empty">载入中…</div></div>
  <footer id="foot">确认击杀 +1 · 首杀 +1 · 误伤 −2 · 周一开榜</footer>
</main>
<script>
  var params = new URLSearchParams(location.search);
  var me = params.get('me');
  if (me) history.replaceState(null, '', location.pathname);

  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(data) {
    var seasonEl = document.getElementById('season');
    var board = document.getElementById('board');
    var foot = document.getElementById('foot');
    var days = Math.max(0, Math.ceil((data.season.ends_at - data.updated_at) / 86400));
    seasonEl.textContent = '第 ' + (data.season.id % 100) + ' 周 · 剩 ' + days + ' 天';
    if (!data.rows.length) {
      board.innerHTML = '<div class="empty">本周还没有人开火</div>';
    } else {
      var html = '';
      for (var i = 0; i < data.rows.length; i++) {
        var row = data.rows[i];
        var isMe = data.me && row.id === data.me.id;
        html += '<div class="row' + (isMe ? ' me' : '') + '">'
          + '<span class="rank">' + row.rank + '</span>'
          + '<span class="who"><span class="name">'
          + (row.title ? '<span class="title">◆ ' + esc(row.title) + '</span>' : '')
          + esc(row.name) + '</span>'
          + (row.bio ? '<div class="bio">' + esc(row.bio) + '</div>' : '')
          + '</span>'
          + '<span class="stats"><span class="kills">' + row.kills + ' 只野</span>'
          + '<span class="accuracy">' + Math.round(row.accuracy * 100) + '%</span></span>'
          + '</div>';
      }
      board.innerHTML = html;
    }
    if (data.last_season && data.last_season.champions && data.last_season.champions.length) {
      var champs = data.last_season.champions.map(function (c) { return esc(c.name); }).join('、');
      foot.textContent = '上届冠军 ' + champs + ' · 第 ' + (data.last_season.id % 100) + ' 周';
    }
  }

  function refresh() {
    fetch('/v1/leaderboard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(me ? { me: me } : {}),
    }).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) render(data); })
      .catch(function () {});
  }

  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  refresh();
</script>
</body>
</html>`;
}

export { escapeHtml };