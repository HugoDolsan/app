/* ============================================================
   Planejamento HD — local-first task planner synced to Sheets
   ============================================================ */
'use strict';

/* ---------------- state ---------------- */
const APP_VERSION = 'v15';
/* URL do Apps Script embutida — leitura aberta a quem tiver o link do site;
   a escrita (push) é protegida pelo Token de escrita (WRITE_TOKEN no script) */
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw-Oa-CYQ8qafhsbhTF4uhKGU8dHk4Kn21_DvSEMhDyLxpq3YtJeKoG3CilVRKJ3kkZ/exec';
/* MODO PADRÃO = leitura (dados ao vivo). A edição destrava quando o aparelho
   tem o Token de escrita salvo. ?share=1 força leitura mesmo com token. */
const RO_PARAM = new URLSearchParams(location.search).get('share') || null;
const ISO_RE=/^\d{4}-\d{2}-\d{2}$/;
const isIso=s=>typeof s==='string'&&ISO_RE.test(s);
const LS_KEY = 'pt_state_v2';

function freshState(){
  return {
    tasks: JSON.parse(JSON.stringify(SEED.tasks)),
    projects: JSON.parse(JSON.stringify(SEED.projects)),
    settings: { scriptUrl:DEFAULT_SCRIPT_URL, lastSync:null, dirty:false }
  };
}
function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    if(!s.tasks || !s.projects) return null;
    return s;
  }catch(e){ return null; }
}
const _stored = loadState();
const RO = !!RO_PARAM || !(_stored && _stored.settings && _stored.settings.writeToken);
let S;
if(RO){
  S = freshState();   /* mostra o snapshot embutido; ⟳ traz os dados atuais */
  S.settings.scriptUrl = (RO_PARAM && RO_PARAM.startsWith('http')) ? decodeURIComponent(RO_PARAM) : DEFAULT_SCRIPT_URL;
}else{
  S = _stored || freshState();
  if(!S.settings.scriptUrl) S.settings.scriptUrl = DEFAULT_SCRIPT_URL;
}
function save(){ S.settings.dirty = true; persist(); }
function persist(){
  if(RO) return;                     /* visualização não grava nada no aparelho */
  try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(e){ toast('Erro ao salvar localmente','err'); }
  $('#sync-dot').hidden = !S.settings.dirty;
}

/* ---------------- date helpers (all ISO yyyy-mm-dd, UTC) ---------------- */
const DAY = 86400000;
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function pd(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function iso(dt){ return dt.toISOString().slice(0,10); }
function todayISO(){ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; }
function fmt(isoStr){ if(!isoStr) return ''; const [y,m,d]=isoStr.split('-'); return `${d}/${m}/${y.slice(2)}`; }
function diffDays(a,b){ return Math.round((pd(b)-pd(a))/DAY); }
function isWeekend(dt){ const w=dt.getUTCDay(); return w===0||w===6; }
function addWorkdays(startIso, n){
  let dt = pd(startIso); n = Math.round(n);
  while(n>0){ dt = new Date(dt.getTime()+DAY); if(!isWeekend(dt)) n--; }
  return iso(dt);
}

/* ---------------- sheet formulas, replicated ---------------- */
/* dias úteis no intervalo (a, b] — inverso exato de addWorkdays */
function workdaysBetween(a,b){
  let d=pd(a); const end=pd(b); let n=0;
  while(d<end){ d=new Date(d.getTime()+DAY); if(!isWeekend(d)) n++; }
  return n;
}
function fimPlanejado(t){
  if(t.fimManual) return t.fimManual;
  if(!t.inicio || t.esforco===null || t.esforco===undefined || t.esforco==='') return null;
  return addWorkdays(t.inicio, t.esforco);
}
/* esforço efetivo: digitado, ou calculado a partir do Fim manual */
function esforcoEff(t){
  if(t.fimManual && t.inicio) return workdaysBetween(t.inicio, t.fimManual);
  return t.esforco;
}
/* effective % — replicates the auto-progress formula on autoPct rows.
   Returns number 0..1, or 'V' ("Verificar") */
function pctEff(t){
  if(!t.autoPct) return t.pct || 0;
  const h=t.inicio, j=fimPlanejado(t), today=todayISO();
  if(!h) return 0;
  if(today<=h) return 0;
  if(j && today>=j) return 'V';
  if(!j) return 0;
  const total=diffDays(h,j)||1;
  return Math.min(1, diffDays(h,today)/total);
}
/* status — replicates column L exactly; manual value overrides the formula,
   exactly like typing over the formula in the sheet */
function statusOf(t){
  if(t.statusManual) return t.statusManual;
  const h=t.inicio, j=fimPlanejado(t), today=todayISO();
  const k=pctEff(t);
  if(!h) return k===0 ? 'Standby' : (k===1 ? 'Concluído' : 'Em andamento');
  if(k===0 && h>=today) return 'Não iniciado';
  if(k===1) return 'Concluído';
  if(k===0) return 'Standby';
  if(j && j<today) return 'Atrasado';
  return 'Em andamento';
}
const STATUS = {
  'Não iniciado': {c:'var(--st-nao)', cls:'c-nao'},
  'Em andamento': {c:'var(--st-and)', cls:'c-and'},
  'Concluído':    {c:'var(--st-con)', cls:'c-con'},
  'Atrasado':     {c:'var(--st-atr)', cls:'c-atr'},
  'Standby':      {c:'var(--st-stb)', cls:'c-stb'},
};
function projOf(t){ return S.projects.find(p=>p.id.toLowerCase()===String(t.projId).toLowerCase()); }
function projName(t){ const p=projOf(t); return p ? (p.nome||p.id) : t.projId; }
/* aceita nome OU id digitado; devolve o ID para armazenar/sincronizar */
function resolveProjInput(text){
  const s=String(text||'').trim();
  if(!s) return '';
  const byName=S.projects.find(p=>(p.nome||'').toLowerCase()===s.toLowerCase());
  if(byName) return byName.id;
  const byId=S.projects.find(p=>p.id.toLowerCase()===s.toLowerCase());
  if(byId) return byId.id;
  return s;
}

/* ---------------- filters ---------------- */
/* filtro por EXCLUSÃO: todos os status visíveis por padrão; clicar esconde */
const F = { hidden:new Set(), proj:'', q:'' };
function passFilter(t){
  if(F.hidden.has(statusOf(t))) return false;
  if(F.proj && String(t.projId).toLowerCase()!==F.proj.toLowerCase()) return false;
  if(F.q){
    const q=F.q.toLowerCase();
    const hay=`${t.tarefa||''} ${t.obs||''} ${projName(t)||''} ${t.resp||''}`.toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}
function renderFilterbar(){
  const chips = $('#status-chips');
  chips.innerHTML='';
  Object.entries(STATUS).forEach(([name,meta])=>{
    const n = S.tasks.filter(t=>statusOf(t)===name).length;
    const visible = !F.hidden.has(name);
    const b=document.createElement('button');
    b.className='chip '+(visible?'on ':'off ')+meta.cls;
    b.innerHTML=`<span class="dot" style="background:${meta.c}"></span>${name} · ${n}`;
    b.onclick=()=>{ F.hidden.has(name)?F.hidden.delete(name):F.hidden.add(name); renderAll(); };
    chips.appendChild(b);
  });
  const sel=$('#f-proj');
  const cur=F.proj;
  const ids=new Set(S.projects.map(p=>p.id.toLowerCase()));
  const extra=[...new Set(S.tasks.map(t=>String(t.projId)).filter(id=>id&&!ids.has(id.toLowerCase())))];
  sel.innerHTML='<option value="">Todos os projetos</option>'+
    S.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===cur?'selected':''}>${esc(p.nome||p.id)}</option>`).join('')+
    extra.map(id=>`<option value="${esc(id)}" ${id===cur?'selected':''}>${esc(id)}</option>`).join('');
  $('#dl-proj').innerHTML=
    S.projects.map(p=>`<option value="${esc(p.nome||p.id)}"></option>`).join('')+
    extra.map(id=>`<option value="${esc(id)}"></option>`).join('');
}
$('#f-proj').onchange=e=>{ F.proj=e.target.value; renderAll(); };
$('#f-q').oninput=e=>{ F.q=e.target.value.trim(); renderAll(); };
$('#f-lanes').onchange=e=>{
  S.settings.calLanes=parseInt(e.target.value,10);
  if(!RO){ try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(_){} }
  renderAll();
};

/* ---------------- calendar (screen 1) ---------------- */
const now=new Date();
const cal={ y:now.getFullYear(), m:now.getMonth(), sel:null };
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DOW=['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];

function calMonthRange(){
  const first=new Date(Date.UTC(cal.y,cal.m,1));
  const last=new Date(Date.UTC(cal.y,cal.m+1,0));
  return [iso(first), iso(last)];
}
function taskInRange(t,a,b){
  const h=t.inicio, j=fimPlanejado(t)||t.inicio;
  if(!h) return false;
  return h<=b && j>=a;
}
/* para as listas: também entra quem tem Conclusão (quando for data) no período */
function listInRange(t,a,b){
  if(taskInRange(t,a,b)) return true;
  return !!(isIso(t.conclusao) && t.conclusao>=a && t.conclusao<=b);
}
function renderCalendar(){
  $('#cal-title').innerHTML=`${MESES[cal.m]} ${cal.y}`;
  $('#cal-dow').innerHTML=DOW.map(d=>`<div>${d}</div>`).join('');

  const first=new Date(Date.UTC(cal.y,cal.m,1));
  const offset=(first.getUTCDay()+6)%7;               // Monday start
  const start=new Date(first.getTime()-offset*DAY);
  const daysInMonth=new Date(Date.UTC(cal.y,cal.m+1,0)).getUTCDate();
  const weeks=Math.ceil((offset+daysInMonth)/7);
  const today=todayISO();
  const grid=$('#cal-grid'); grid.innerHTML='';

  const visTasks=S.tasks.filter(t=>passFilter(t) && t.inicio);
  const doneSet=new Set(S.tasks.filter(t=>passFilter(t)&&isIso(t.conclusao)).map(t=>t.conclusao));

  for(let w=0;w<weeks;w++){
    const wkStart=new Date(start.getTime()+w*7*DAY);
    const wkA=iso(wkStart), wkB=iso(new Date(wkStart.getTime()+6*DAY));
    const week=document.createElement('div'); week.className='cal-week';

    const dayEls=[];
    for(let d=0;d<7;d++){
      const dt=new Date(wkStart.getTime()+d*DAY);
      const dIso=iso(dt);
      const el=document.createElement('div');
      el.className='cal-day'
        +(dt.getUTCMonth()!==cal.m?' out':'')
        +(isWeekend(dt)?' wkend':'')
        +(dIso===today?' today':'')
        +(dIso===cal.sel?' sel':'');
      el.innerHTML=`<span class="dnum">${dt.getUTCDate()}</span>`
        +(doneSet.has(dIso)?'<span class="cdone">✓</span>':'');
      el.onclick=()=>{ cal.sel = (cal.sel===dIso? null : dIso); renderCalendar(); };
      week.appendChild(el); dayEls.push({el,iso:dIso});
    }

    /* lay out bars in lanes — quantidade do seletor "N/dia".
       Piso de legibilidade (barra 11px / fonte 8px): quando não cabe,
       a semana cresce em altura — o texto nunca desaparece. */
    const MAXL=Math.max(2,Math.min(8, S.settings.calLanes||4));
    const laneSp=Math.max(13, Math.floor(58/MAXL));
    const barH=laneSp-2;
    const barFs=Math.min(9.5, Math.max(8, barH-4));
    week.style.minHeight=Math.max(84, 28 + MAXL*laneSp)+'px';
    const bars=document.createElement('div'); bars.className='cal-bars';
    const wkTasks=visTasks
      .filter(t=>taskInRange(t,wkA,wkB))
      .sort((a,b)=> (a.inicio<b.inicio?-1:a.inicio>b.inicio?1:0));
    const lanes=[]; const overflow={};
    wkTasks.forEach(t=>{
      const j=fimPlanejado(t)||t.inicio;
      const c0=Math.max(0, diffDays(wkA, t.inicio<wkA?wkA:t.inicio));
      const c1=Math.min(6, diffDays(wkA, j>wkB?wkB:j));
      let lane=lanes.findIndex(end=>end<c0);
      if(lane===-1){ lane=lanes.length; lanes.push(-1); }
      if(lane>=MAXL){
        for(let c=c0;c<=c1;c++) overflow[c]=(overflow[c]||0)+1;
        return;
      }
      lanes[lane]=c1;
      const st=statusOf(t); const meta=STATUS[st];
      const bar=document.createElement('div');
      bar.className='cal-bar'
        +((t.precisao||'Janela')==='Janela'?' janela':'')
        +(t.inicio>=wkA?' rstart':'')
        +(j<=wkB?' rend':'');
      bar.style.cssText=`left:calc(${c0}/7*100% + 2px);width:calc(${c1-c0+1}/7*100% - 5px);top:${lane*laneSp}px;background:${meta.c};height:${barH}px;line-height:${barH}px;font-size:${barFs}px`;
      bar.textContent=t.tarefa||'(sem nome)';
      bar.title=t.tarefa||'';
      bar.onclick=ev=>{ ev.stopPropagation(); openTaskModal(S.tasks.indexOf(t)); };
      bars.appendChild(bar);
    });
    Object.entries(overflow).forEach(([c,n])=>{
      const cell=dayEls[c].el;
      const m=document.createElement('span'); m.className='more'; m.textContent=`+${n}`;
      cell.appendChild(m);
    });
    week.appendChild(bars);
    grid.appendChild(week);
  }
  renderCalList();
}
function renderCalList(){
  const [a,b]=calMonthRange();
  const head=$('#daylist-head');
  let list;
  if(cal.sel){
    list=S.tasks.filter(t=>passFilter(t)&&listInRange(t,cal.sel,cal.sel));
    head.innerHTML=`<span>Tarefas em ${fmt(cal.sel)}</span><button class="clear">ver mês todo ✕</button>`;
    head.querySelector('.clear').onclick=()=>{ cal.sel=null; renderCalendar(); };
  }else{
    list=S.tasks.filter(t=>passFilter(t)&&listInRange(t,a,b));
    head.innerHTML=`<span>Tarefas do mês · ${list.length}</span>`;
  }
  list.sort((x,y)=> (x.inicio||'9')< (y.inicio||'9')?-1:1);
  const wrap=$('#cal-list'); wrap.innerHTML='';
  if(!list.length){ wrap.innerHTML='<div class="empty">Nenhuma tarefa aqui.<br>Toque em + para adicionar.</div>'; return; }
  list.forEach(t=>wrap.appendChild(taskCard(t)));
}
function taskCard(t){
  const st=statusOf(t), meta=STATUS[st], k=pctEff(t);
  const pctTxt = k==='V' ? 'Verificar' : Math.round((k||0)*100)+'%';
  const el=document.createElement('div'); el.className='tcard';
  el.innerHTML=`
    <div class="stripe" style="background:${meta.c}"></div>
    <div class="body">
      <div class="thead2">
        <div class="tleft">
          <div class="t1"><span class="name">${esc(t.tarefa||'(sem nome)')}</span></div>
          <div class="proj">${esc(projName(t)||'')}</div>
        </div>
        ${t.obs?`<div class="obs">${esc(t.obs)}</div>`:''}
      </div>
      <div class="t2">
        <span class="pill" style="background:${meta.c}">${st}</span>
        <span class="dates">${fmt(t.inicio)}${fimPlanejado(t)?' → '+fmt(fimPlanejado(t)):''}</span>
        ${t.conclusao?`<span class="concl">✔ ${isIso(t.conclusao)?fmt(t.conclusao):esc(t.conclusao)}</span>`:''}
        ${t.resp?`<span class="resp">${esc(t.resp)}</span>`:''}
        <span class="dates"><b>${pctTxt}</b></span>
      </div>
      <div class="pbar"><i style="width:${k==='V'?100:Math.round((k||0)*100)}%;background:${meta.c}"></i></div>
    </div>`;
  el.onclick=()=>openTaskModal(S.tasks.indexOf(t));
  return el;
}
$('#cal-prev').onclick=()=>{ cal.m--; if(cal.m<0){cal.m=11;cal.y--;} cal.sel=null; renderCalendar(); };
$('#cal-next').onclick=()=>{ cal.m++; if(cal.m>11){cal.m=0;cal.y++;} cal.sel=null; renderCalendar(); };
$('#cal-title').onclick=()=>{ const n=new Date(); cal.y=n.getFullYear(); cal.m=n.getMonth(); cal.sel=todayISO(); renderCalendar(); };

/* ---------------- table (screen 2) ---------------- */
const COLS=[
  {k:'projId',     h:'Projeto',       edit:'proj'},
  {k:'tarefa',     h:'Tarefa',        edit:'text',   cls:'c-tarefa'},
  {k:'obs',        h:'Obs',           edit:'textarea'},
  {k:'inicio',     h:'Início Planej.',edit:'date'},
  {k:'esforco',    h:'Esforço (dias)',edit:'number', cls:'num'},
  {k:'_fim',       h:'Fim Planej.',   edit:'fimplan'},
  {k:'pct',        h:'% Final.',      edit:'pct',    cls:'num'},
  {k:'_status',    h:'Status',        edit:'status'},
  {k:'resp',       h:'Responsável',   edit:'text'},
  {k:'precisao',   h:'Precisão',      edit:'precisao'},
  {k:'interessado',h:'Interessado',   edit:'text'},
  {k:'conclusao',  h:'Conclusão',     edit:'text'},
  {k:'inicioReal', h:'Início Real',   edit:'date'},
  {k:'esforcoReal',h:'Esforço Real',  edit:'number', cls:'num'},
  {k:'fimReal',    h:'Fim Real',      edit:'date'},
];
function cellText(t,c){
  if(c.k==='projId') return esc(projName(t));
  if(c.k==='conclusao') return isIso(t.conclusao)?fmt(t.conclusao):esc(t.conclusao||'');
  if(c.k==='esforco'){ const e=esforcoEff(t); return (e==null?'':String(e))+(t.fimManual?' <span class="autoflag">⚙</span>':''); }
  if(c.k==='_fim') return fmt(fimPlanejado(t))+(t.fimManual?'':' <span class="autoflag">⚙</span>');
  if(c.k==='_status'){ const st=statusOf(t); return `<span class="pill" style="background:${STATUS[st].c}">${st}</span>`+(t.statusManual?'':' <span class="autoflag">⚙</span>'); }
  if(c.k==='pct'){ const k=pctEff(t); return (k==='V'?'Verificar':Math.round((k||0)*100)+'%')+(t.autoPct?' <span class="autoflag">⚙</span>':''); }
  if(c.edit==='date') return fmt(t[c.k]);
  if(c.k==='esforco'||c.k==='esforcoReal') return t[c.k]==null?'':String(t[c.k]);
  return esc(t[c.k]==null?'':String(t[c.k]));
}
function renderTable(){
  const wrap=$('#table-wrap');
  const sx=wrap.scrollLeft, sy=wrap.scrollTop;
  $('#thead').innerHTML='<tr><th class="rownum">#</th>'+COLS.map(c=>`<th class="${c.cls||''}">${c.h}</th>`).join('')+'</tr>';
  const tb=$('#tbody'); tb.innerHTML='';
  const frag=document.createDocumentFragment();
  S.tasks.forEach((t,i)=>{
    if(!passFilter(t)) return;
    const tr=document.createElement('tr');
    let html=`<td class="rownum" data-row="${i}">${i+1}</td>`;
    COLS.forEach((c,ci)=>{ html+=`<td class="${c.cls||''}" data-row="${i}" data-col="${ci}">${cellText(t,c)}</td>`; });
    tr.innerHTML=html;
    frag.appendChild(tr);
  });
  tb.appendChild(frag);
  wrap.scrollLeft=sx; wrap.scrollTop=sy;
}
$('#tbody').addEventListener('click',e=>{
  if(e.target.closest('input,select')) return;      /* already editing */
  const td=e.target.closest('td'); if(!td) return;
  const row=+td.dataset.row;
  if(td.classList.contains('rownum')){ openRowMenu(row); return; }
  const col=COLS[+td.dataset.col];
  if(col.edit==='textarea'){ openCellEditor(row,col); return; }   /* obs: caixa maior */
  inlineEdit(td,row,col);
});

/* ---------------- inline (in-cell) editing, spreadsheet style ---------------- */
const ST_NAMES=Object.keys(STATUS);
function inlineEdit(td,row,col){
  if(RO){ toast('Modo somente leitura'); return; }
  const t=S.tasks[row];
  let el;
  if(col.edit==='proj'){
    el=document.createElement('input');
    el.type='text'; el.setAttribute('list','dl-proj');
    el.value=projName(t)||''; el.placeholder='nome do projeto';
  }else if(col.edit==='precisao'){
    el=document.createElement('select');
    el.innerHTML=`<option value="Janela" ${(t.precisao||'Janela')==='Janela'?'selected':''}>Janela</option><option value="Exata" ${t.precisao==='Exata'?'selected':''}>Exata</option>`;
  }else if(col.edit==='status'){
    el=document.createElement('select');
    el.innerHTML=`<option value="">⚙ Automático (${statusOf({...t,statusManual:null})})</option>`+
      ST_NAMES.map(s=>`<option value="${s}" ${t.statusManual===s?'selected':''}>${s}</option>`).join('');
  }else if(col.edit==='pct'){
    el=document.createElement('input');
    el.type='number'; el.min=0; el.max=100; el.step=5;
    el.placeholder='auto';
    if(!t.autoPct) el.value=Math.round((t.pct||0)*100);
    el.title='Vazio = automático (fórmula da planilha)';
  }else if(col.edit==='fimplan'){
    el=document.createElement('input'); el.type='date'; el.value=fimPlanejado(t)||'';
    el.title='Definir o Fim recalcula o esforço em dias úteis; vazio volta ao automático';
  }else if(col.edit==='date'){
    el=document.createElement('input'); el.type='date'; el.value=t[col.k]||'';
  }else if(col.edit==='number'){
    el=document.createElement('input'); el.type='number'; el.step='0.5'; el.value=t[col.k]??'';
  }else{
    el=document.createElement('input'); el.type='text'; el.value=t[col.k]||'';
  }
  el.className='cell-inline';
  td.innerHTML=''; td.appendChild(el);
  el.focus();
  if(el.select) try{ el.select(); }catch(_){}
  let done=false;
  const commit=()=>{
    if(done) return; done=true;
    const v=el.value;
    if(col.edit==='pct'){
      if(v===''){ t.autoPct=true; }
      else { t.pct=Math.min(100,Math.max(0,parseFloat(v)))/100; t.autoPct=false; }
    }else if(col.edit==='status'){
      t.statusManual=v||null;
    }else if(col.edit==='fimplan'){
      if(!v){ t.fimManual=null; }
      else if(t.inicio && v<t.inicio){ toast('Fim antes do início','err'); cancel(); return; }
      else { t.fimManual=v; if(t.inicio) t.esforco=workdaysBetween(t.inicio,v); }
    }else if(col.k==='esforco'){ t.esforco=v===''?null:parseFloat(v); t.fimManual=null; }
    else if(col.edit==='number'){ t[col.k]=v===''?null:parseFloat(v); }
    else if(col.edit==='date'){ t[col.k]=v||null; }
    else if(col.edit==='proj'){
      if(!v.trim()){ toast('Informe o projeto','err'); cancel(); return; }
      t.projId=resolveProjInput(v);
    }
    else if(col.edit==='precisao'){ t[col.k]=v; }
    else {
      const nv=v.trim()===''?null:v.trim();
      if(col.k==='tarefa'&&!nv){ toast('Tarefa precisa de nome','err'); cancel(); return; }
      t[col.k]=nv;
    }
    save(); renderAll();
  };
  const cancel=()=>{ if(done) return; done=true; renderTable(); };
  el.addEventListener('blur',commit);
  el.addEventListener('keydown',ev=>{
    if(ev.key==='Enter'){ ev.preventDefault(); el.blur(); }
    else if(ev.key==='Escape'){ ev.preventDefault(); done=true; renderTable(); }
  });
  if(el.tagName==='SELECT') el.addEventListener('change',()=>el.blur());
}

/* ---------------- sheets/modals plumbing ---------------- */
function openSheet(id){ $('#overlay').hidden=false; $(id).hidden=false; }
function closeSheets(){
  $('#overlay').hidden=true;
  $$('.sheet').forEach(s=>s.hidden=true);
}
$('#overlay').onclick=closeSheets;
$$('[data-close]').forEach(b=>b.onclick=closeSheets);
function confirmBox(msg){
  return new Promise(res=>{
    $('#confirm-msg').textContent=msg;
    $('#confirm').hidden=false;
    $('#confirm-yes').onclick=()=>{ $('#confirm').hidden=true; res(true); };
    $('#confirm-no').onclick =()=>{ $('#confirm').hidden=true; res(false); };
  });
}
let toastTimer;
function toast(msg,cls){
  const t=$('#toast');
  t.textContent=msg; t.className='toast '+(cls||''); t.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.hidden=true,2600);
}
function esc(s){ return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ---------------- full task editor ---------------- */
let editIdx=null; /* null = new */
function fieldHTML(t){
  const resps=[...new Set(S.tasks.map(x=>x.resp).filter(Boolean))].sort();
  const k=pctEff(t); const pctVal=k==='V'?100:Math.round((k||0)*100);
  return `
  <label class="lbl">Projeto</label>
  <input class="inp" name="projId" list="dl-proj" value="${esc(projName(t)||'')}" placeholder="Digite o nome do projeto...">
  <p class="hint">Filtra os projetos enquanto digita; um nome novo também é aceito.</p>
  <label class="lbl">Tarefa</label>
  <input class="inp" name="tarefa" value="${esc(t.tarefa)}" placeholder="O que precisa ser feito?">
  <div class="frow">
    <div><label class="lbl">Início planejado</label><input class="inp" type="date" name="inicio" value="${t.inicio||''}"></div>
    <div><label class="lbl">Precisão da data</label>
      <select class="sel" name="precisao">
        <option value="Janela" ${(t.precisao||'Janela')==='Janela'?'selected':''}>Janela</option>
        <option value="Exata" ${t.precisao==='Exata'?'selected':''}>Exata</option>
      </select></div>
  </div>
  <div class="frow">
    <div><label class="lbl" id="lbl-esf">Esforço (dias úteis)${t.fimManual?' ⚙':''}</label><input class="inp" type="number" step="0.5" min="0" name="esforco" value="${esforcoEff(t)??''}"></div>
    <div><label class="lbl" id="lbl-fim">Fim planejado${t.fimManual?'':' ⚙'}</label><input class="inp" type="date" name="fimPlan" value="${fimPlanejado(t)||''}"></div>
  </div>
  <p class="hint">Preencha um dos dois — o outro é calculado (⚙) em dias úteis.</p>
  <label class="lbl">% finalizado</label>
  <div class="pct-row">
    <input type="range" name="pct" min="0" max="100" step="5" value="${pctVal}">
    <span class="pct-val">${k==='V'?'Verif.':pctVal+'%'}</span>
  </div>
  ${t.autoPct
    ? '<div class="autopct-note">⚙ % automático (fórmula da planilha). Mover o controle passa a manual.</div>'
    : '<button type="button" class="btn ghost mini" id="pct-auto-btn">↺ Voltar % ao automático</button>'}
  <label class="lbl">Status</label>
  <select class="sel" name="statusManual">
    <option value="">⚙ Automático (${statusOf({...t,statusManual:null})})</option>
    ${Object.keys(STATUS).map(s=>`<option value="${s}" ${t.statusManual===s?'selected':''}>${s}</option>`).join('')}
  </select>
  <div class="frow">
    <div><label class="lbl">Responsável</label><input class="inp" name="resp" list="dl-resp" value="${esc(t.resp||'')}">
      <datalist id="dl-resp">${resps.map(r=>`<option value="${esc(r)}">`).join('')}</datalist></div>
    <div><label class="lbl">Interessado</label><input class="inp" name="interessado" value="${esc(t.interessado||'')}"></div>
  </div>
  <label class="lbl">Obs</label>
  <textarea class="inp" name="obs">${esc(t.obs||'')}</textarea>
  <div class="frow">
    <div><label class="lbl">Início real</label><input class="inp" type="date" name="inicioReal" value="${t.inicioReal||''}"></div>
    <div><label class="lbl">Fim real</label><input class="inp" type="date" name="fimReal" value="${t.fimReal||''}"></div>
  </div>
  <div class="frow">
    <div><label class="lbl">Esforço real</label><input class="inp" type="number" step="0.5" name="esforcoReal" value="${t.esforcoReal??''}"></div>
    <div><label class="lbl">Conclusão (texto livre)</label><input class="inp" name="conclusao" value="${esc(t.conclusao||'')}" placeholder="ex.: entregue dia X / 2026-07-20"></div>
  </div>`;
}
function blankTask(){
  return { uid:'n'+Date.now()+Math.random().toString(36).slice(2,6),
    projId:S.projects[0]?S.projects[0].id:'', tarefa:'', obs:null, conclusao:null,
    inicio: cal.sel || todayISO(), esforco:1, fimManual:null, pct:0, autoPct:true, statusManual:null,
    resp:'Hugo', precisao:'Janela', interessado:null,
    inicioReal:null, esforcoReal:null, fimReal:null };
}
function openTaskModal(idx, presetInicio){
  if(RO){ toast('Modo somente leitura'); return; }
  editIdx = idx;
  const t = idx==null ? blankTask() : S.tasks[idx];
  if(idx==null && presetInicio) t.inicio=presetInicio;
  $('#task-modal-title').textContent = idx==null ? 'Nova tarefa' : 'Editar tarefa';
  $('#task-delete').style.display = idx==null ? 'none' : '';
  const form=$('#task-form');
  form.innerHTML=fieldHTML(t);
  form.dataset.blank = idx==null ? JSON.stringify(t) : '';
  const range=form.querySelector('[name=pct]');
  range.dataset.touched='';
  form.dataset.pctAuto='';
  range.oninput=()=>{ range.dataset.touched='1'; form.dataset.pctAuto=''; form.querySelector('.pct-val').textContent=range.value+'%'; };
  const autoBtn=form.querySelector('#pct-auto-btn');
  if(autoBtn) autoBtn.onclick=()=>{
    form.dataset.pctAuto='1'; range.dataset.touched='';
    autoBtn.textContent='⚙ % automático ao salvar ✓';
  };
  /* esforço ⇄ fim: quem for editado por último manda; o outro recalcula ao vivo */
  form.dataset.dur = t.fimManual ? 'fim' : 'esf';
  const esfEl=form.querySelector('[name=esforco]'), fimEl=form.querySelector('[name=fimPlan]'), iniEl=form.querySelector('[name=inicio]');
  const syncDur=()=>{
    const ini=iniEl.value;
    if(!ini) return;
    if(form.dataset.dur==='fim'){
      if(fimEl.value && fimEl.value>=ini) esfEl.value=workdaysBetween(ini, fimEl.value);
    }else if(esfEl.value!==''){
      fimEl.value=addWorkdays(ini, parseFloat(esfEl.value));
    }
    $('#lbl-esf').textContent='Esforço (dias úteis)'+(form.dataset.dur==='fim'?' ⚙':'');
    $('#lbl-fim').textContent='Fim planejado'+(form.dataset.dur==='fim'?'':' ⚙');
  };
  esfEl.oninput=()=>{ form.dataset.dur='esf'; syncDur(); };
  fimEl.oninput=()=>{ form.dataset.dur='fim'; syncDur(); };
  iniEl.oninput=syncDur;
  openSheet('#sheet-task');
}
$('#task-save').onclick=()=>{
  const form=$('#task-form');
  const t = editIdx==null ? JSON.parse(form.dataset.blank) : S.tasks[editIdx];
  const v=n=>{ const el=form.querySelector(`[name=${n}]`); return el?el.value:null; };
  t.projId=resolveProjInput(v('projId')); t.tarefa=v('tarefa').trim();
  if(!t.projId){ toast('Informe o projeto','err'); return; }
  t.inicio=v('inicio')||null;
  if(form.dataset.dur==='fim' && v('fimPlan')){
    if(t.inicio && v('fimPlan')<t.inicio){ toast('Fim antes do início','err'); return; }
    t.fimManual=v('fimPlan');
    t.esforco = t.inicio ? workdaysBetween(t.inicio, t.fimManual) : t.esforco;
  }else{
    t.esforco=v('esforco')===''?null:parseFloat(v('esforco'));
    t.fimManual=null;
  }
  t.precisao=v('precisao');
  const range=form.querySelector('[name=pct]');
  if(form.dataset.pctAuto){ t.autoPct=true; }
  else if(range.dataset.touched){ t.pct=parseInt(range.value,10)/100; t.autoPct=false; }
  t.statusManual=v('statusManual')||null;
  t.resp=v('resp')||null; t.interessado=v('interessado')||null;
  t.obs=v('obs')||null;
  t.inicioReal=v('inicioReal')||null; t.fimReal=v('fimReal')||null;
  t.esforcoReal=v('esforcoReal')===''?null:parseFloat(v('esforcoReal'));
  t.conclusao=v('conclusao')||null;
  if(!t.tarefa){ toast('Dê um nome à tarefa','err'); return; }
  if(editIdx==null) S.tasks.push(t);
  save(); closeSheets(); renderAll();
  toast(editIdx==null?'Tarefa adicionada':'Tarefa salva');
};
$('#task-delete').onclick=async()=>{
  if(editIdx==null) return;
  const t=S.tasks[editIdx];
  if(await confirmBox(`Excluir a tarefa "${t.tarefa}"?`)){
    S.tasks.splice(editIdx,1);
    save(); closeSheets(); renderAll(); toast('Tarefa excluída');
  }
};

/* ---------------- single-cell editor ---------------- */
let cellCtx=null;
function openCellEditor(row,col){
  if(RO){ toast('Modo somente leitura'); return; }
  cellCtx={row,col};
  const t=S.tasks[row];
  $('#cell-title').textContent=`${col.h} — linha ${row+1}`;
  const box=$('#cell-editor');
  const val=t[col.k];
  if(col.edit==='proj'){
    box.innerHTML=`<select class="sel" id="cell-inp">${S.projects.map(p=>`<option value="${esc(p.id)}" ${String(val).toLowerCase()===p.id.toLowerCase()?'selected':''}>${esc(p.nome||p.id)} (${esc(p.id)})</option>`).join('')}</select>`;
  }else if(col.edit==='precisao'){
    box.innerHTML=`<select class="sel" id="cell-inp"><option value="Janela" ${(val||'Janela')==='Janela'?'selected':''}>Janela</option><option value="Exata" ${val==='Exata'?'selected':''}>Exata</option></select>`;
  }else if(col.edit==='date'){
    box.innerHTML=`<input class="inp" type="date" id="cell-inp" value="${val||''}"><p class="hint">Deixe vazio para limpar.</p>`;
  }else if(col.edit==='number'){
    box.innerHTML=`<input class="inp" type="number" step="0.5" id="cell-inp" value="${val??''}">`;
  }else if(col.edit==='pct'){
    const k=pctEff(t); const pv=k==='V'?100:Math.round((k||0)*100);
    box.innerHTML=`<div class="pct-row"><input type="range" id="cell-inp" min="0" max="100" step="5" value="${pv}"><span class="pct-val" id="cell-pctv">${k==='V'?'Verif.':pv+'%'}</span></div>
      ${t.autoPct?'<div class="autopct-note">⚙ % automático — salvar torna manual.</div>':''}`;
    box.querySelector('#cell-inp').oninput=e=>{ $('#cell-pctv').textContent=e.target.value+'%'; };
  }else if(col.edit==='textarea'){
    box.innerHTML=`<textarea class="inp" id="cell-inp">${esc(val||'')}</textarea>`;
  }else{
    box.innerHTML=`<input class="inp" id="cell-inp" value="${esc(val||'')}">`;
  }
  openSheet('#sheet-cell');
  const inp=$('#cell-inp');
  if(col.edit==='text') setTimeout(()=>inp.focus(),150);
}
$('#cell-save').onclick=()=>{
  const {row,col}=cellCtx; const t=S.tasks[row];
  const inp=$('#cell-inp'); let v=inp.value;
  if(col.edit==='pct'){ t.pct=parseInt(v,10)/100; t.autoPct=false; }
  else if(col.edit==='number'){ t[col.k]= v===''?null:parseFloat(v); }
  else if(col.edit==='date'){ t[col.k]= v||null; }
  else { t[col.k]= v.trim()===''?null:v.trim(); if(col.k==='tarefa'&&!t[col.k]){toast('Tarefa precisa de nome','err');return;} }
  save(); closeSheets(); renderAll(); toast(col.h+' atualizado');
};

/* ---------------- row menu ---------------- */
let rowCtx=null;
function openRowMenu(row){
  if(RO){ toast('Modo somente leitura'); return; }
  rowCtx=row;
  $('#row-title').textContent=`Linha ${row+1} — ${S.tasks[row].tarefa||'(sem nome)'}`;
  openSheet('#sheet-row');
}
function insertAt(pos){
  const t=blankTask();
  const ref=S.tasks[rowCtx];
  if(ref){ t.projId=ref.projId; t.resp=ref.resp; }
  t.inicio=todayISO();
  S.tasks.splice(pos,0,t);
  save(); closeSheets(); renderAll();
  openTaskModal(pos);
}
$('#row-above').onclick=()=>insertAt(rowCtx);
$('#row-below').onclick=()=>insertAt(rowCtx+1);
$('#row-dup').onclick=()=>{
  const c=JSON.parse(JSON.stringify(S.tasks[rowCtx]));
  c.uid='n'+Date.now(); c.tarefa=(c.tarefa||'')+' (cópia)';
  S.tasks.splice(rowCtx+1,0,c);
  save(); closeSheets(); renderAll(); toast('Linha duplicada');
};
$('#row-del').onclick=async()=>{
  const t=S.tasks[rowCtx];
  if(await confirmBox(`Excluir a linha ${rowCtx+1} ("${t.tarefa}")?`)){
    S.tasks.splice(rowCtx,1);
    save(); closeSheets(); renderAll(); toast('Linha excluída');
  }
};

/* ---------------- sync ---------------- */
$('#btn-sync').onclick=()=>{
  if(RO){ roPull(); return; }        /* no modo leitura, o botão ⟳ atualiza os dados */
  $('#sync-url').value=S.settings.scriptUrl||'';
  $('#sync-token').value=S.settings.writeToken||'';
  $('#sync-info').textContent = 'App '+APP_VERSION+' · '+(S.settings.lastSync
    ? 'Última sincronização: '+new Date(S.settings.lastSync).toLocaleString('pt-BR')
    : 'Nunca sincronizado.');
  openSheet('#sheet-sync');
};
$('#sync-url').onchange=e=>{ S.settings.scriptUrl=e.target.value.trim(); persist(); };
$('#sync-token').onchange=e=>{
  const val=e.target.value.trim();
  if(RO){
    /* digitar o token no modo leitura destrava a edição neste aparelho */
    if(!val) return;
    const st=loadState()||freshState();
    st.settings.writeToken=val;
    st.settings.scriptUrl=st.settings.scriptUrl||DEFAULT_SCRIPT_URL;
    try{ localStorage.setItem(LS_KEY, JSON.stringify(st)); }catch(_){}
    location.href=location.pathname;   /* recarrega sem ?share, já como editor */
    return;
  }
  S.settings.writeToken=val; persist();
};
$('#btn-sharelink').onclick=async()=>{
  const link=location.origin+location.pathname+'?share=1';
  try{ await navigator.clipboard.writeText(link); toast('Link de leitura copiado ✓'); }
  catch(e){ prompt('Copie o link:', link); }
};
/* pull do modo leitura: só memória, nada é salvo no aparelho */
async function roPull(){
  try{
    toast('Atualizando...');
    const j=await api({action:'pull'});
    S.tasks=(j.tasks||[]).map((t,i)=>({...t, uid:'s'+i, autoPct:!!t.autoPct}));
    if(j.projects && j.projects.length) S.projects=j.projects;
    renderAll();
    toast(S.tasks.length+' tarefas · atualizado ✓');
  }catch(e){ toast('Erro ao carregar: '+e.message,'err'); }
}
async function api(payload){
  const url=S.settings.scriptUrl;
  if(!url) throw new Error('Configure a URL do Apps Script primeiro.');
  const res=await fetch(url,{ method:'POST', body:JSON.stringify(payload) });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const j=await res.json();
  if(j.error) throw new Error(j.error);
  return j;
}
$('#btn-pull').onclick=async()=>{
  if(RO){ closeSheets(); roPull(); return; }
  if(!(await confirmBox('Baixar da planilha SUBSTITUI os dados do app pelos da planilha. Continuar?'))) return;
  try{
    toast('Baixando...');
    const j=await api({action:'pull'});
    if(!j.tasks) throw new Error('Resposta inesperada');
    S.tasks=j.tasks.map((t,i)=>({...t, uid:'s'+i, autoPct:!!t.autoPct}));
    if(j.projects && j.projects.length) S.projects=j.projects;
    S.settings.lastSync=Date.now(); S.settings.dirty=false; persist();
    closeSheets(); renderAll();
    toast(`Baixado: ${S.tasks.length} tarefas ✓`);
  }catch(e){ toast('Erro: '+e.message,'err'); }
};
$('#btn-push').onclick=async()=>{
  /* recarrega o estado salvo antes de enviar — evita mandar dados velhos
     se outra aba/janela editou depois desta */
  const fresh=loadState();
  if(fresh){ S=fresh; renderAll(); }
  if(!(await confirmBox(`Enviar ${S.tasks.length} tarefas para a planilha? Isso SOBRESCREVE as linhas da aba Tarefas.`))) return;
  try{
    toast('Enviando...');
    const j=await api({action:'push', token:S.settings.writeToken||'', tasks:S.tasks.map(t=>({...t, esforco: esforcoEff(t)}))});
    S.settings.lastSync=Date.now(); S.settings.dirty=false; persist();
    closeSheets();
    toast(`Enviado: ${j.written||S.tasks.length} tarefas ✓`);
  }catch(e){ toast('Erro: '+e.message,'err'); }
};
/* backup / restore */
$('#btn-backup').onclick=()=>{
  const blob=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='planejamento-backup-'+todayISO()+'.json';
  a.click();
};
$('#btn-restore').onclick=()=>$('#restore-file').click();
$('#restore-file').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{
    const s=JSON.parse(await f.text());
    if(!s.tasks) throw new Error('arquivo inválido');
    S=s; persist(); closeSheets(); renderAll(); toast('Backup restaurado ✓');
  }catch(err){ toast('Erro no backup: '+err.message,'err'); }
};

/* ---------------- table zoom ---------------- */
function applyZoom(){
  const z=S.settings.tableZoom||1;
  $('#view-table').style.setProperty('--tzoom', z);
  $('#zoom-val').textContent=Math.round(z*100)+'%';
}
function setZoom(dz){
  const z=Math.min(1.8, Math.max(0.55, (S.settings.tableZoom||1)+dz));
  S.settings.tableZoom=Math.round(z*100)/100;
  localStorage.setItem(LS_KEY, JSON.stringify(S));   /* não marca como alteração de dados */
  applyZoom();
}
$('#zoom-in').onclick=()=>setZoom(0.15);
$('#zoom-out').onclick=()=>setZoom(-0.15);

/* ---------------- navigation ---------------- */
let curView='cal';
$$('.tab').forEach(b=>b.onclick=()=>{
  curView=b.dataset.view;
  $$('.tab').forEach(x=>x.classList.toggle('active',x===b));
  $('#view-cal').hidden = curView!=='cal';
  $('#view-table').hidden = curView!=='table';
  renderAll();
});
$('#fab').onclick=()=>openTaskModal(null, cal.sel);

/* ---------------- sincronia entre abas/janelas do mesmo navegador ---------------- */
window.addEventListener('storage', ev=>{
  if(ev.key===LS_KEY && ev.newValue){
    try{ S=JSON.parse(ev.newValue); renderAll(); }catch(_){}
  }
});
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  const f=loadState();
  if(f && JSON.stringify(f.tasks)!==JSON.stringify(S.tasks)){ S=f; renderAll(); }
});

/* ---------------- render ---------------- */
function renderAll(){
  renderFilterbar();
  if(curView==='cal') renderCalendar(); else renderTable();
}
persist();
applyZoom();
$('#f-lanes').value=String(Math.max(2,Math.min(8,S.settings.calLanes||4)));
if(RO){
  document.body.classList.add('ro');
  $('#ro-banner').hidden=false;
  $('#fab').style.display='none';
  document.title='Planejamento HD · leitura';
  /* tocar na faixa abre o painel do token (desbloqueio da edição) */
  $('#ro-banner').onclick=()=>{
    $('#sync-token').value='';
    $('#sync-info').textContent='App '+APP_VERSION+' · modo leitura. Digite o token para desbloquear a edição neste aparelho.';
    openSheet('#sheet-sync');
  };
  renderAll();   /* mostra o snapshot embutido; dados atuais vêm no botão ⟳ */
}else{
  renderAll();
}
