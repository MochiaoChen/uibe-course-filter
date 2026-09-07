export const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '').toLocaleUpperCase();
export const numeric = value => value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export const normalizePlace = value => normalize(value).replace(/博学楼?/g, '博');
export function timeCodes(row) {
  // Use the site's actual big-period codes, not a guessed day + individual period conversion.
  return [...new Set([...String(row.teachingPlace || '').matchAll(/\/\s*([1-7][0-9A-Za-z]+)\s*\//g)].map(m => normalize(m[1])))];
}
export function course(row, main) {
  const code = normalize(row.KCH), id = String(row.JXBID || '');
  const mainStatus = !main?.complete ? 'unknown' : main.classIds.has(id) ? 'exact' : main.courseCodes.has(code) ? 'course' : 'absent';
  const selected = numeric(row.numberOfSelected), capacity = numeric(row.classCapacity);
  return {id, code, section:String(row.KXH ?? ''), name:String(row.KCM || ''), teacher:String(row.SKJS || '').replace(/\[[^\]]*\]/g,''), credits:numeric(row.XF), type:String(row.KCLB || '未分类'), nature:String(row.KCXZ || ''), department:String(row.KKDW || ''),
    times:timeCodes(row), schedule:String(row.KCDZ || row.teachingPlaceHide || '时间待定'), place:[...new Set((row.SKSJ || []).map(s => s.YPSJDD).filter(Boolean))].join('；'),
    selected,capacity,remaining:capacity !== null && selected !== null ? capacity-selected : null, mainStatus, raw:row};
}
export function mainIndex(main) {
  return {complete:main?.complete === true, courseCodes:new Set((main?.courseCodes || []).map(normalize)), classIds:new Set((main?.classIds || []).map(String))};
}
export function matches(c, f) {
  if (f.scope === 'main' && !['exact','course'].includes(c.mainStatus)) return false;
  if (f.scope === 'unknown' && c.mainStatus !== 'unknown') return false;
  if (f.scope === 'absent' && c.mainStatus !== 'absent') return false;
  for (const [value,query] of [[c.name,f.name],[c.teacher,f.teacher],[c.code+' '+c.section,f.number]]) if (normalize(query) && !normalize(value).includes(normalize(query))) return false;
  if (normalizePlace(f.place) && !normalizePlace(c.place).includes(normalizePlace(f.place))) return false;
  if (f.credits?.length && !f.credits.includes(String(c.credits))) return false;
  if (f.types?.length && !f.types.includes(c.type)) return false;
  if (f.times?.length) {
    const present = t => c.times.includes(normalize(t));
    if (f.timeMode === 'exclude' ? f.times.some(present) : f.timeMode === 'all' ? !f.times.every(present) : !f.times.some(present)) return false;
    // Unknown scheduling must not masquerade as free time under exclusion.
    if (f.timeMode === 'exclude' && !c.times.length) return false;
  }
  if (f.available && !(c.remaining > 0)) return false;
  for (const [value,min,max] of [[c.selected,f.selectedMin,f.selectedMax],[c.capacity,f.capacityMin,f.capacityMax]]) {
    if (min !== '' && min != null && (value === null || value < Number(min))) return false;
    if (max !== '' && max != null && (value === null || value > Number(max))) return false;
  }
  return true;
}
export const labels = {exact:'主修 · 已核验班次',course:'主修课程 · 班次待核验',absent:'未在当前主修列表',unknown:'主修尚未核验'};
export function sortCourses(rows, key) {
  const [field,direction] = key.split(':'); const sign = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a,b) => {
    if (a[field] === null && b[field] !== null) return 1;
    if (b[field] === null && a[field] !== null) return -1;
    return (typeof a[field] === 'number' ? a[field]-b[field] : String(a[field]??'').localeCompare(String(b[field]??''),'zh-CN',{numeric:true}))*sign || a.code.localeCompare(b.code) || a.section.localeCompare(b.section,undefined,{numeric:true});
  });
}
export async function collectPages(read, scope, contextKey, progress, cancelled, pause = ms => new Promise(r => setTimeout(r,ms))) {
  const all=[], keys=new Set(); let total;
  for (let page=1; total === undefined || all.length < total; page++) {
    if (cancelled()) throw new Error('已取消同步，原有数据未被覆盖。');
    const result = await read({kind:'page',scope,contextKey,page});
    if (!Number.isInteger(result.total) || result.total < 0 || result.total > 100000 || (total !== undefined && total !== result.total)) throw new Error('课程总数异常或同步期间发生变化，请重新同步。');
    total=result.total;
    const expected=Math.min(100,total-all.length);
    if (!Array.isArray(result.rows) || result.rows.length < expected || result.rows.length > Math.min(300,total-all.length)) throw new Error('分页数量不符，未保存不完整数据。');
    for (const row of result.rows.slice(0,expected)) {
      const key = scope === 'all' ? row.JXBID : row.key;
      if (!key || keys.has(key)) throw new Error('分页出现重复或缺少编号，未保存不完整数据。');
      keys.add(key);all.push(row);
    }
    progress(scope,all.length,total);
    if (all.length < total) await pause(1100);
  }
  if (cancelled()) throw new Error('已取消同步，原有数据未被覆盖。');
  return all;
}
