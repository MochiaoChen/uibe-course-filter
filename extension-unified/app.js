import {course,mainIndex,matches,sortCourses,labels,numeric,collectPages} from './core.js';
const $ = s => document.querySelector(s), form = $('#filters');
const extension = Boolean(globalThis.chrome?.runtime?.id);
const param = new URLSearchParams(location.search).get('sourceTab');
const tabId = param && /^\d+$/.test(param) ? Number(param) : null;
let snapshot, courses=[], scope='all', page=1, syncing=false, cancel=false, context=null;
function say(text,error=false) {$('#status').textContent=text;$('#status').classList.toggle('error',error);}
function element(tag,text,className) {const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
const showNumber = n => n === null ? '—' : n;
function options(id, values, name) {
  const box=$(id);box.replaceChildren();const any=element('option','全部');any.value='';box.append(any);
  for(const value of values) {const option=element('option',value);option.value=value;box.append(option);}
}
function filters() {const f=new FormData(form);return Object.assign(Object.fromEntries(f),{scope,credits:f.getAll('credits').filter(Boolean),types:f.getAll('types').filter(Boolean),times:String(f.get('times')||'').split(/[\s,，、;；]+/).filter(Boolean),available:f.has('available')});}
function chooseScope(value) {scope=value;document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===scope)));page=1;render();}
function useData(data, preferMain=false) {
  snapshot=data;const index=mainIndex(data.main);courses=data.rows.map(r=>course(r,index));
  options('#credits',[...new Set(courses.map(c=>c.credits).filter(c=>c!==null))].sort((a,b)=>a-b).map(String),'credits');
  options('#types',[...new Set(courses.map(c=>c.type))].sort((a,b)=>a.localeCompare(b,'zh-CN')),'types');
  $('#term').textContent=data.term || '';
  $('#source').textContent=`${data.main?.complete ? '本机同步快照' : '随插件提供的全校快照'} · ${new Date(data.exportedAt).toLocaleString('zh-CN',{hour12:false})}`;
  $('#main-summary').textContent=data.main?.complete ? `${data.main.courseCodes.length} 门课程出现在主修列表 · ${courses.filter(c=>c.mainStatus==='exact').length} 个班次已核验` : '主修尚未同步';
  chooseScope(preferMain?'main':'all');
}
function render() {
  const f=filters();
  const invalid=[['selectedMin','selectedMax'],['capacityMin','capacityMax']].some(([a,b])=>f[a]!==''&&f[b]!==''&&Number(f[a])>Number(f[b]));
  const query=String($('#search').value||'').replace(/\s/g,'').toUpperCase();
  const result=invalid?[]:sortCourses(courses.filter(c=>matches(c,f)&&(!query || [c.name,c.teacher,c.code+c.section,c.place].some(v=>v.replace(/\s/g,'').toUpperCase().includes(query)))),$('#sort').value);
  const pages=Math.max(1,Math.ceil(result.length/40));page=Math.min(page,pages);
  $('#count').textContent=`${result.length.toLocaleString()} 个教学班 · ${new Set(result.map(c=>c.code)).size} 门课程`;
  $('#page').textContent=`${page} / ${pages}`;$('#prev').disabled=page===1;$('#next').disabled=page===pages;
  $('#rows').replaceChildren();
  $('#empty').hidden=result.length>0;
  $('#empty-tip').textContent=invalid?'人数或容量的最小值不能大于最大值。':scope==='main'&&!snapshot?.main?.complete?'请先点击“同步全校与我的主修”，完成后即可筛选主修。':'试着减少筛选条件，或切换到全校课程。';
  for(const c of result.slice((page-1)*40,page*40)) {
    const tr=document.createElement('tr'), cells=Array.from({length:10},()=>document.createElement('td'));
    cells[0].textContent=result.indexOf(c)+1;
    const nameButton=element('button',c.name,'course-name');nameButton.type='button';nameButton.onclick=()=>showDetail(c);cells[1].append(nameButton);
    cells[2].append(element('span',c.code+' / '+c.section,'mono'));
    cells[3].textContent=showNumber(c.credits);
    cells[4].textContent=c.teacher||'待定';
    for(const t of c.times)cells[5].append(element('span',t,'time-tag mono'));
    if(!c.times.length)cells[5].textContent='待定';
    cells[5].append(element('div',c.schedule,'full-schedule'));
    cells[6].textContent=c.place||'待定';
    cells[7].append(element('span',`${showNumber(c.selected)} / ${showNumber(c.capacity)}`,'mono'),element('small',c.remaining>0?`余 ${c.remaining}`:c.remaining===null?'未知':c.remaining===0?'已满':'超额',c.remaining>0?'available':''));
    cells[8].append(element('span',c.type,'type-tag'));
    cells[9].append(element('span',labels[c.mainStatus],'badge '+c.mainStatus));
    tr.append(...cells);$('#rows').append(tr);
  }
}
async function read(command) {
  if(!extension) throw new Error('当前为本地预览。实时同步请加载 Chrome 插件，并从原站选课页面打开。');
  const response=await chrome.runtime.sendMessage({type:'read',tabId,command});
  if(!response || response.error) throw new Error(response?.error||'插件连接中断，请重新打开。');return response.data;
}
async function sync() {
  if(syncing)return;syncing=true;cancel=false;$('#sync').disabled=true;$('#cancel').hidden=false;
  try {
    context=await read({kind:'context'});
    if(!context.mainType)throw new Error('原站未提供主修课程入口，无法核验主修。');
    if(snapshot?.contextKey && snapshot.contextKey!==context.contextKey) {
      useData({...snapshot,main:null});say('账号或轮次已变化，已清除旧主修标记。');
    }
    const progress=(s,n,t)=>say(`正在同步${s==='all'?'全校课程':'我的主修'} ${n} / ${t}…`);
    const rows=await collectPages(read,'all',context.contextKey,progress,()=>cancel);
    await new Promise(r=>setTimeout(r,1100));
    const membership=await collectPages(read,'main',context.contextKey,progress,()=>cancel);
    const finalContext=await read({kind:'context'});
    if(finalContext.contextKey!==context.contextKey)throw new Error('账号或轮次已变化，请重新同步。');
    if(cancel)throw new Error('已取消同步，原有数据未被覆盖。');
    const main={complete:true,courseCodes:[...new Set(membership.flatMap(r=>r.courseCodes))],classIds:[...new Set(membership.flatMap(r=>r.classIds))],records:membership.length};
    const data={rows,main,contextKey:context.contextKey,term:[...new Set(rows.map(r=>r.schoolTerm))].join(','),exportedAt:new Date().toISOString()};
    await chrome.storage.local.set({snapshot:data});
    useData(data,true);say('同步完成，已切换到我的主修。');
  } catch(error) {say(error.message,true);} finally {syncing=false;$('#sync').disabled=false;$('#cancel').hidden=true;}
}
form.addEventListener('submit',e=>e.preventDefault());form.addEventListener('input',()=>{page=1;render();});form.addEventListener('change',()=>{page=1;render();});form.addEventListener('reset',()=>setTimeout(()=>{$('#search').value='';page=1;render();},0));
$('#search').addEventListener('input',()=>{page=1;render();});
$('#sort').addEventListener('change',()=>{page=1;render();});
document.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>chooseScope(b.dataset.scope)));
$('#prev').onclick=()=>{page--;render();};$('#next').onclick=()=>{page++;render();};$('#sync').onclick=sync;$('#cancel').onclick=()=>{cancel=true;say('正在取消，将在当前请求结束后停止。');};
try {
  const response=await fetch('snapshot.json');if(!response.ok)throw new Error('本地课程文件加载失败。');useData(await response.json());
  if(extension&&tabId) {
    try {context=await read({kind:'context'});const saved=(await chrome.storage.local.get('snapshot')).snapshot;if(saved?.contextKey===context.contextKey)useData(saved,true);else say('已连接原站，可同步你的主修课程。');}
    catch(error){say(error.message,true);}
  } else if(!extension) say('本地预览 · 安装插件后可同步我的主修');
} catch(error){say(error.message,true);}

function showDetail(c){
 const box=$('#detail-body');box.replaceChildren();$('#detail-title').textContent=c.name;
 for(const [name,value] of [['课程号 / 课序号',c.code+' / '+c.section],['主修归属',labels[c.mainStatus]],['学分',c.credits],['授课教师',c.teacher],['上课安排',c.schedule],['上课地点',c.place],['课程类型',c.type+' · '+c.nature],['开课单位',c.department],['选课人数 / 容量',showNumber(c.selected)+' / '+showNumber(c.capacity)],['本科计划容量',showNumber(numeric(c.raw.BKSKRL))]]){
 const item=element('div','','detail-row');item.append(element('dt',name),element('dd',value??'未知'));box.append(item);
 }
 $('#detail').showModal();
}
$('#close-detail').onclick=()=>$('#detail').close();

// Move the original controls instead of duplicating forms: values and listeners stay intact.
const layoutSelect=$('#layout');
const slots=[...document.querySelectorAll('.column-filters th')].map((cell,index)=>({cell,index,nodes:[...cell.childNodes]})).filter(slot=>slot.cell.querySelector('input,select'));
const fieldNames={1:'课程名称',2:'课程号 / 课序号',3:'学分',4:'授课教师',5:'上课时间',6:'上课地点',8:'课程类型'};
for(const slot of slots){
 slot.group=element('div','','sidebar-field');slot.group.append(element('div',fieldNames[slot.index],'field-label'));$('#sidebar-fields').append(slot.group);
}
function setLayout(value,save=false){
 const layout=value==='sidebar'?'sidebar':'table';
 document.body.dataset.layout=layout;layoutSelect.value=layout;$('#sidebar').hidden=layout!=='sidebar';
 for(const slot of slots)for(const node of slot.nodes)(layout==='sidebar'?slot.group:slot.cell).append(node);
 if(save){try{localStorage.setItem('bkxk-layout',layout);}catch{}}
}
layoutSelect.addEventListener('change',()=>setLayout(layoutSelect.value,true));
let savedLayout='table';try{savedLayout=localStorage.getItem('bkxk-layout')||'table';}catch{}
setLayout(savedLayout);

// Column widths belong to the shared table and therefore survive layout changes.
const grid=document.querySelector('table');
const columns=[...grid.querySelectorAll('col')];
const defaultWidths=columns.map(c=>parseFloat(c.style.width));
let widths=[...defaultWidths], sidebarWidth=265;
try{
 const saved=JSON.parse(localStorage.getItem('bkxk-widths')||'null');
 if(Array.isArray(saved?.columns)&&saved.columns.length===columns.length&&saved.columns.every(w=>Number.isFinite(w)&&w>=48&&w<=900))widths=saved.columns;
 if(Number.isFinite(saved?.sidebar))sidebarWidth=Math.max(200,Math.min(500,saved.sidebar));
}catch{}
function applyWidths(){
 columns.forEach((c,i)=>c.style.width=widths[i]+'px');
 grid.style.width=widths.reduce((a,b)=>a+b,0)+'px';
 grid.style.minWidth='0';
 document.documentElement.style.setProperty('--sidebar-width',sidebarWidth+'px');
 grid.querySelectorAll('tr').forEach(row=>{if(row.children[1])row.children[1].style.left=widths[0]+'px';});
 grid.querySelectorAll('.column-resizer').forEach((handle,i)=>handle.setAttribute('aria-valuenow',Math.round(widths[i])));
}
function saveWidths(){try{localStorage.setItem('bkxk-widths',JSON.stringify({columns:widths,sidebar:sidebarWidth}));}catch{}}
function draggable(handle,getValue,setValue,min,max){
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  event.preventDefault();const start=event.clientX,value=getValue();handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing');
  const move=e=>{setValue(Math.max(min,Math.min(max,value+e.clientX-start)));applyWidths();};
  const end=()=>{document.body.classList.remove('resizing');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);saveWidths();};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
 });
 handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();setValue(Math.max(min,Math.min(max,getValue()+(e.key==='ArrowLeft'?-10:10))));applyWidths();saveWidths();});
}
[...grid.tHead.rows[0].cells].forEach((cell,i)=>{
 const handle=element('button','','column-resizer');handle.type='button';handle.setAttribute('aria-label','调整'+cell.textContent.trim()+'列宽');handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','48');handle.setAttribute('aria-valuemax','900');cell.append(handle);
 draggable(handle,()=>widths[i],value=>widths[i]=value,48,900);
 handle.addEventListener('dblclick',()=>{widths[i]=defaultWidths[i];applyWidths();saveWidths();});
});
const sidebarHandle=element('button','','sidebar-resizer');sidebarHandle.type='button';sidebarHandle.setAttribute('aria-label','调整筛选侧栏宽度');document.querySelector('.workspace').append(sidebarHandle);
draggable(sidebarHandle,()=>sidebarWidth,value=>sidebarWidth=value,200,500);
const resetWidths=element('button','重置宽度','resize-reset');resetWidths.type='button';document.querySelector('.toolbar').append(resetWidths);
resetWidths.onclick=()=>{widths=[...defaultWidths];sidebarWidth=265;applyWidths();saveWidths();};
// Rows are recreated when filtering/paging. Keep the frozen column offset aligned.
new MutationObserver(()=>{grid.querySelectorAll('tbody tr').forEach(row=>{if(row.children[1])row.children[1].style.left=widths[0]+'px';});}).observe($('#rows'),{childList:true});
applyWidths();
