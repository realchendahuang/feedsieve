import { REPORT_REASONS } from './lib/validate';

export function maintainerPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FeedSieve 维护者黑名单</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171714;background:#f5f4ee}
    *{box-sizing:border-box}body{margin:0}.shell{max-width:980px;margin:0 auto;padding:32px 20px 64px}
    header{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:22px}
    h1{margin:0;font-size:26px}p{color:#646258}.card{background:#fff;border:1px solid #dedbd0;border-radius:16px;padding:18px;margin-top:16px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wide{grid-column:1/-1}label{display:grid;gap:6px;font-size:13px;font-weight:650}
    input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:10px 12px;border:1px solid #cbc7b9;border-radius:10px;background:#fff}
    textarea{min-height:76px;resize:vertical}.actions{display:flex;gap:10px;align-items:center;margin-top:14px}
    button{border:0;border-radius:10px;padding:10px 14px;background:#171714;color:#fff;font-weight:700;cursor:pointer}
    button.secondary{background:#eeeae0;color:#292821}button.danger{background:#fff0ed;color:#a82b20;border:1px solid #efc5bf;padding:7px 10px}
    .row-actions{display:flex;gap:6px}.row-actions .secondary{padding:7px 10px}
    button:disabled{opacity:.45;cursor:not-allowed}.status{min-height:20px;font-size:13px;color:#646258}.status.error{color:#b3261e}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:11px 8px;border-bottom:1px solid #ece9df;vertical-align:top}
    th{color:#6d695e;font-size:12px}.muted{color:#777268}.inactive{opacity:.5}.token{display:flex;gap:10px}.token input{flex:1}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:700px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}header{align-items:start;flex-direction:column}.table-wrap{overflow:auto}}
  </style>
</head>
<body><main class="shell">
  <header><div><h1>维护者黑名单</h1><p>维护者条目与社区票数分开公开，不伪造社区共识。</p></div><a href="/v1/blocklist/latest.yaml">查看公开 YAML</a></header>
  <section class="card">
    <label>管理员令牌</label>
    <div class="token"><input id="token" type="password" autocomplete="off" placeholder="仅保存在当前标签页"><button id="connect">连接</button></div>
  </section>
  <section class="card">
    <form id="entry-form">
      <div class="grid">
        <label>X 用户名<input name="handle" required placeholder="@handle"></label>
        <label>稳定用户 ID（可选）<input name="x_user_id" inputmode="numeric" placeholder="rest_id"></label>
        <label>分类<select name="category"></select></label>
        <label>证据推文 ID（可选）<input name="evidence_post_id" inputmode="numeric"></label>
        <label class="wide">维护说明<textarea name="note" required minlength="4" maxlength="240" placeholder="为什么加入维护者黑名单；会公开显示"></textarea></label>
      </div>
      <div class="actions"><button type="submit">加入或更新黑名单</button><span id="status" class="status"></span></div>
    </form>
  </section>
  <section class="card"><div class="table-wrap"><table><thead><tr><th>账号</th><th>分类</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody id="entries"></tbody></table></div></section>
</main>
<script>
const categories=${JSON.stringify(REPORT_REASONS)};
const categoryLabels={bot_spam:'机器人垃圾',copy_paste:'重复刷屏',ai_slop:'AI 垃圾',advertising:'广告引流',adult_gray_traffic:'色情灰产引流',scam_phishing:'诈骗钓鱼',engagement_bait:'互动诱导',other:'其他'};
const tokenInput=document.querySelector('#token');const statusEl=document.querySelector('#status');const body=document.querySelector('#entries');const formEl=document.querySelector('#entry-form');
const categorySelect=document.querySelector('select[name="category"]');for(const value of categories){const option=document.createElement('option');option.value=value;option.textContent=categoryLabels[value]||value;categorySelect.append(option)}
tokenInput.value=sessionStorage.getItem('feedsieve-admin-token')||'';
function token(){return tokenInput.value.trim()}function auth(){return {Authorization:'Bearer '+token(),'Content-Type':'application/json'}}
function setStatus(message,error=false){statusEl.textContent=message;statusEl.classList.toggle('error',error)}
async function api(path,init={}){const response=await fetch(path,{...init,headers:{...auth(),...(init.headers||{})}});const data=await response.json().catch(()=>({error:'invalid_response'}));if(!response.ok)throw new Error(data.error||('HTTP '+response.status));return data}
function cell(text){const td=document.createElement('td');td.textContent=text??'';return td}
function editEntry(entry){formEl.elements.handle.value=entry.handle;formEl.elements.x_user_id.value=entry.x_user_id||'';formEl.elements.category.value=entry.category;formEl.elements.evidence_post_id.value=entry.evidence_post_id||'';formEl.elements.note.value=entry.note;formEl.elements.note.focus();formEl.scrollIntoView({behavior:'smooth',block:'center'});setStatus('正在编辑 @'+entry.handle)}
async function load(){if(!token())return;setStatus('读取中…');try{const data=await api('/admin/blocklist');body.replaceChildren();for(const entry of data.entries){const tr=document.createElement('tr');if(!entry.active)tr.className='inactive';tr.append(cell('@'+entry.handle),cell(categoryLabels[entry.category]||entry.category),cell(entry.note),cell(entry.active?'生效':'已撤销'));const action=document.createElement('td');const controls=document.createElement('div');controls.className='row-actions';const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent=entry.active?'编辑':'重新加入';edit.addEventListener('click',()=>editEntry(entry));controls.append(edit);if(entry.active){const button=document.createElement('button');button.type='button';button.className='danger';button.textContent='撤销';button.addEventListener('click',async()=>{if(!confirm('撤销 @'+entry.handle+' 的维护者条目？'))return;button.disabled=true;try{await api('/admin/blocklist/'+encodeURIComponent(entry.handle),{method:'DELETE'});await load()}catch(error){setStatus(error.message,true)}finally{button.disabled=false}});controls.append(button)}action.append(controls);tr.append(action);body.append(tr)}setStatus('已连接，共 '+data.entries.filter(entry=>entry.active).length+' 个生效条目')}catch(error){setStatus(error.message,true)}}
document.querySelector('#connect').addEventListener('click',()=>{sessionStorage.setItem('feedsieve-admin-token',token());load()});
formEl.addEventListener('submit',async event=>{event.preventDefault();if(!token()){setStatus('请先输入管理员令牌',true);return}const form=new FormData(event.currentTarget);const payload=Object.fromEntries(form.entries());for(const key of ['x_user_id','evidence_post_id'])if(!payload[key])delete payload[key];setStatus('保存中…');try{await api('/admin/blocklist',{method:'POST',body:JSON.stringify(payload)});event.currentTarget.reset();categorySelect.value=categories[0];await load()}catch(error){setStatus(error.message,true)}});
if(token())load();
</script></body></html>`;
}
