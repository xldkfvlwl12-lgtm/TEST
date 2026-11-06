'use strict';
const $ = id => document.getElementById(id);
const states = {todo:'할 일',doing:'진행 중',done:'완료'};
const priorities = {high:'높음',normal:'보통',low:'낮음'};
const config = window.MOA_CONFIG;
const sessionKey = 'moa-auth-session-v1';
let tasks=[], editing=null, dragging=null, session=null, busy=false, ready=false;
let loadVersion=0, refreshPromise=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setSession(value) {
  session=value;
  // 카드 데이터는 저장하지 않습니다. 로그인 토큰만 탭 세션에 보관합니다.
  try { if(value) sessionStorage.setItem(sessionKey,JSON.stringify(value)); else sessionStorage.removeItem(sessionKey); } catch {}
  $('account-status').textContent=value?.user?.email || '로그인하지 않음';
  $('logout').hidden=!value;
  $('auth-form').hidden=!!value;
}
async function request(path, {method='GET', body, token, representation=false}={}) {
  const headers={apikey:config.publishableKey};
  // publishable 키는 JWT가 아니므로 Authorization에 넣지 않습니다.
  if(token) headers.Authorization=`Bearer ${token}`;
  if(body!==undefined) headers['Content-Type']='application/json';
  if(representation) headers.Prefer='return=representation';
  let response;
  try { response=await fetch(config.supabaseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'}); }
  catch { throw new Error('서버에 연결하지 못했습니다. 인터넷 연결과 Supabase 프로젝트 상태를 확인하세요.'); }
  const text=await response.text();
  let data=null;
  try { data=text?JSON.parse(text):null; } catch { /* 서버 응답이 JSON이 아닌 경우 */ }
  if(!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `요청 실패 (${response.status})`);
  return data;
}
async function accessToken() {
  if(!session) return undefined;
  if(session.expires_at*1000 > Date.now()+60000) return session.access_token;
  if(!refreshPromise) refreshPromise=(async()=>{
    const previous=session;
    try {
      const result=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:previous.refresh_token}});
      if(session!==previous) throw new Error('로그인 상태가 변경되었습니다. 다시 시도하세요.');
      setSession(result);return result.access_token;
    } catch(error) {
      if(session===previous) setSession(null);
      throw error;
    } finally { refreshPromise=null; }
  })();
  return refreshPromise;
}
function boardFilter() {
  if($('scope').value==='public') return 'scope=eq.public&owner_id=is.null';
  if(!session?.user?.id) throw new Error('개인 보드는 먼저 로그인해 주세요.');
  return `scope=eq.private&owner_id=eq.${encodeURIComponent(session.user.id)}`;
}
function lock(value) {
  busy=value;
  $('scope').disabled=value;
  $('reload').disabled=value;
  $('logout').disabled=value;
  $('new').disabled=value||!ready;
  document.querySelectorAll('#form button, #auth-form button').forEach(el=>el.disabled=value);
}
async function loadTasks() {
  const version=++loadVersion;
  ready=false;tasks=[];render();lock(busy);
  $('error').textContent='';
  if($('scope').value==='private'&&!session) { $('error').textContent='개인 보드는 로그인 후 이용할 수 있습니다.';return; }
  $('summary').textContent='불러오는 중…';
  try {
    const token=await accessToken();
    const filter=boardFilter(), rows=[];
    for(let offset=0;;) {
      const page=await request(`/rest/v1/tasks?select=id,title,desc,status,priority,due&${filter}&order=created_at.asc,id.asc&limit=500&offset=${offset}`,{token});
      if(version!==loadVersion)return;
      if(!page.length)break;
      rows.push(...page);offset+=page.length;
    }
    tasks=rows.map(t=>({...t,desc:t.desc||'',due:t.due||''}));
    ready=true;render();
  } catch(error) { if(version===loadVersion) {tasks=[];render();$('error').textContent=error.message;} }
  finally { if(version===loadVersion) lock(busy); }
}
async function mutate(method, body, id=null) {
  if(busy||!ready)return false;
  lock(true);$('error').textContent='';$('modal-error').textContent='';
  try {
    const token=await accessToken();
    const path='/rest/v1/tasks'+(id?`?id=eq.${encodeURIComponent(id)}&${boardFilter()}`:'');
    const rows=await request(path,{method,body,token,representation:true});
    if(!Array.isArray(rows)||rows.length!==1) throw new Error('카드가 없거나 변경 권한이 없습니다. 새로고침 후 다시 시도하세요.');
    if(method==='DELETE') tasks=tasks.filter(t=>t.id!==id);
    else {const row={...rows[0],desc:rows[0].desc||'',due:rows[0].due||''};if(id) tasks=tasks.map(t=>t.id===id?row:t);else tasks.push(row);}
    render();return true;
  } catch(error) { $('error').textContent=error.message;$('modal-error').textContent=error.message;return false; }
  finally {lock(false);}
}

function render(){const q=$('search').value.toLocaleLowerCase(),p=$('filter').value;const visible=tasks.filter(t=>(t.title+' '+t.desc).toLocaleLowerCase().includes(q)&&(!p||t.priority===p));$('summary').textContent=`전체 ${tasks.length}개 · 완료 ${tasks.filter(t=>t.status==='done').length}개`;$('board').innerHTML=Object.entries(states).map(([s,label])=>{const list=visible.filter(t=>t.status===s);return `<section class="column ${s}" data-status="${s}" aria-label="${label}"><div class="col-title"><span class="dot"></span>${label}<span class="count">${list.length}</span><button data-add="${s}" aria-label="${label}에 할 일 추가">＋</button></div><div class="cards">${list.length?list.map(t=>`<article class="card" draggable="true" data-id="${esc(t.id)}"><span class="badge ${t.priority}">${priorities[t.priority]}</span><h3>${esc(t.title)}</h3>${t.desc?`<p>${esc(t.desc)}</p>`:''}<div class="card-foot"><span>${t.due?'마감 '+esc(t.due):'마감일 없음'}</span><button class="edit" data-edit="${esc(t.id)}" aria-label="${esc(t.title)} 수정">수정 ↗</button></div></article>`).join(''):'<div class="empty">아직 등록된 할 일이 없어요.</div>'}</div><button class="add" data-add="${s}">＋ 할 일 추가</button></section>`}).join('');}
function openEditor(id=null,status='todo'){if(!ready||busy)return;editing=id;$('modal-error').textContent='';const t=tasks.find(t=>t.id===id);$('form').reset();$('modal-title').textContent=t?'할 일 수정':'새 할 일';$('title').value=t?.title||'';$('desc').value=t?.desc||'';$('status').value=t?.status||status;$('priority').value=t?.priority||'normal';$('due').value=t?.due||'';$('delete').hidden=!t;$('modal').showModal();$('title').focus();}

$('new').onclick=()=>openEditor();
$('cancel').onclick=()=>{if(!busy)$('modal').close();};
$('modal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('search').oninput=render;$('filter').onchange=render;
$('scope').onchange=()=>{$('modal').close();loadTasks();};
$('reload').onclick=()=>loadTasks();
$('title').oninput=()=>$('title').setCustomValidity('');
$('form').onsubmit=async e=>{
  e.preventDefault();if(busy||!ready)return;
  const title=$('title').value.trim();
  if(!title){$('title').setCustomValidity('제목을 입력해 주세요.');$('title').reportValidity();return;}
  const body={title,desc:$('desc').value.trim(),status:$('status').value,priority:$('priority').value,due:$('due').value||null};
  if(!editing){body.scope=$('scope').value;body.owner_id=body.scope==='private'?session?.user.id:null;}
  if(await mutate(editing?'PATCH':'POST',body,editing))$('modal').close();
};
$('delete').onclick=async()=>{if(!busy&&editing&&confirm('이 할 일을 삭제할까요?'))if(await mutate('DELETE',undefined,editing))$('modal').close();};
$('board').onclick=e=>{const edit=e.target.closest('[data-edit]'),add=e.target.closest('[data-add]');if(edit)openEditor(edit.dataset.edit);if(add)openEditor(null,add.dataset.add);};
$('board').ondragstart=e=>{const card=e.target.closest('.card');if(!card||busy||!ready){e.preventDefault();return;}dragging=card.dataset.id;e.dataTransfer.setData('text/plain',dragging);e.dataTransfer.effectAllowed='move';};
function clearDrag(){dragging=null;document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));}
$('board').ondragover=e=>{const col=e.target.closest('.column');if(col&&dragging&&!busy){e.preventDefault();document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));col.classList.add('over');}};
$('board').ondrop=async e=>{e.preventDefault();const col=e.target.closest('.column'),id=dragging;clearDrag();if(col&&id&&!busy&&ready){const t=tasks.find(t=>t.id===id);if(t&&t.status!==col.dataset.status)await mutate('PATCH',{status:col.dataset.status},id);}};
$('board').ondragend=clearDrag;
async function authenticate(signup=false){
  if(busy||!$('auth-form').reportValidity())return;
  lock(true);$('auth-message').textContent='처리 중…';
  try{
    const body={email:$('email').value.trim(),password:$('password').value};
    const result=await request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{method:'POST',body});
    $('password').value='';
    if(result?.access_token){setSession(result);$('auth-message').textContent='로그인되었습니다.';await loadTasks();}
    else $('auth-message').textContent='가입 요청을 접수했습니다. 이메일 인증이 설정되어 있다면 인증 메일을 확인한 후 로그인하세요.';
  }catch(error){$('auth-message').textContent=error.message;}
  finally{lock(false);}
}
$('auth-form').onsubmit=e=>{e.preventDefault();authenticate();};
$('signup').onclick=()=>authenticate(true);
$('logout').onclick=async()=>{
  if(busy)return;lock(true);
  try{const token=await accessToken();if(token)await request('/auth/v1/logout',{method:'POST',token});$('auth-message').textContent='로그아웃되었습니다.';}
  catch(error){$('auth-message').textContent='이 탭에서 로그아웃했습니다. 서버 세션 종료 실패: '+error.message;}
  finally{setSession(null);$('modal').close();await loadTasks();lock(false);}
};
async function initialize(){
  lock(true);
  try{
    let stored=null;try{stored=JSON.parse(sessionStorage.getItem(sessionKey)||'null');}catch{}
    if(stored?.access_token&&stored?.refresh_token){
      setSession(stored);
      try{const token=await accessToken();const user=await request('/auth/v1/user',{token});setSession({...session,user});}
      catch{setSession(null);$('auth-message').textContent='로그인 세션을 확인할 수 없습니다. 다시 로그인하세요.';}
    }else setSession(null);
    await loadTasks();
  }finally{lock(false);}
}
initialize();
