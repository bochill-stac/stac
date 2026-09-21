const CONFIG = window.STAC_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'numeric',day:'numeric'}).format(d)}
function fmtTime(v){const d=new Date(v);return Number.isNaN(d.getTime())?'--:--':new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(d)}
function openUrl(url){if(url)window.open(url,'_blank','noopener,noreferrer')}

function renderLive(rows){
  const root=$('#liveList'); if(!rows.length){root.innerHTML='<div class="empty">現在、配信中のストリーマーはいません。</div>';return}
  root.innerHTML=rows.map(x=>`<article class="live-card"><div class="thumb" style="background-image:linear-gradient(135deg,rgba(20,21,23,.15),rgba(20,21,23,.45)),url('${esc(x.thumbnail)}')"><span class="live-badge">LIVE NOW</span></div><div class="card-body"><div class="card-streamer">${esc(x.streamer_name)}</div><div class="card-title">${esc(x.title)}</div></div></article>`).join('');
  root.querySelectorAll('.live-card').forEach((el,i)=>el.onclick=()=>openUrl(rows[i].url))
}
function renderUpcoming(rows){
  const root=$('#upcomingList'); if(!rows.length){root.innerHTML='<div class="empty">配信予定はありません。</div>';return}
  root.innerHTML=rows.slice(0,8).map(x=>`<article class="schedule-item"><div><div class="schedule-time">${fmtTime(x.scheduled_start_at)}</div><div class="schedule-date">${fmtDate(x.scheduled_start_at)}</div></div><div class="schedule-streamer">${esc(x.streamer_name)}</div><div class="schedule-title">${esc(x.title)}</div><div class="schedule-arrow">→</div></article>`).join('');
  root.querySelectorAll('.schedule-item').forEach((el,i)=>el.onclick=()=>openUrl(rows[i].url))
}
function renderLatest(rows){
  const root=$('#latestList'); if(!rows.length){root.innerHTML='<div class="empty">まだ最新情報がありません。</div>';return}
  root.innerHTML=rows.slice(0,8).map(x=>`<article class="latest-item"><div class="latest-thumb">${x.thumbnail?`<img src="${esc(x.thumbnail)}" alt="">`:''}</div><div class="latest-copy"><div class="latest-streamer">${esc(x.streamer_name)}</div><div class="latest-title">${esc(x.title)}</div></div><div class="latest-date">${fmtDate(x.published_at)}</div></article>`).join('');
  root.querySelectorAll('.latest-item').forEach((el,i)=>el.onclick=()=>openUrl(rows[i].url))
}

async function loadData(){
  if(!CONFIG.SUPABASE_URL||!CONFIG.SUPABASE_PUBLISHABLE_KEY){$('#lastSync').textContent='Supabase未設定';return}
  try{
    const u=`${CONFIG.SUPABASE_URL}/rest/v1/stac_home?select=*&order=published_at.desc&limit=100`;
    const r=await fetch(u,{headers:{apikey:CONFIG.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${CONFIG.SUPABASE_PUBLISHABLE_KEY}`}});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const rows=await r.json();
    const live=rows.filter(x=>x.status==='live');
    const upcoming=rows.filter(x=>x.status==='upcoming').sort((a,b)=>new Date(a.scheduled_start_at)-new Date(b.scheduled_start_at));
    const latest=rows.filter(x=>x.status==='video'||x.status==='archive').sort((a,b)=>new Date(b.published_at||0)-new Date(a.published_at||0));
    renderLive(live);renderUpcoming(upcoming);renderLatest(latest);
    $('#lastSync').textContent=`最終確認 ${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`;
  }catch(e){console.error(e);$('#lastSync').textContent='接続エラー'}
}
function clock(){ $('#clock').textContent=new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()) }
function setView(v){document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===v));const id=v==='live'?'#liveSection':v==='upcoming'?'#upcomingSection':v==='latest'?'#latestSection':null;if(id)$(id).scrollIntoView({behavior:'smooth'});else window.scrollTo({top:0,behavior:'smooth'});if(innerWidth<=800)closeMobile()}
document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.view)));
const sidebar=$('#sidebar'),main=document.querySelector('.main');
$('#collapseMenu').onclick=()=>{const c=sidebar.classList.toggle('collapsed');main.classList.toggle('sidebar-collapsed',c);$('#collapseMenu').textContent=c?'›':'‹'};
function openMobile(){sidebar.classList.add('open');$('#sidebarOverlay').classList.add('show')}
function closeMobile(){sidebar.classList.remove('open');$('#sidebarOverlay').classList.remove('show')}
$('#mobileMenu').onclick=openMobile;$('#sidebarOverlay').onclick=closeMobile;
clock();setInterval(clock,1000);loadData();setInterval(loadData,60000);
