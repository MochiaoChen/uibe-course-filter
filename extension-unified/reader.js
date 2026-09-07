// Serialized by chrome.scripting: this function must remain self-contained.
// Only the course-list endpoint is callable. No credentials are returned.
export async function readPage(command) {
  if (location.origin !== 'https://bkxk.uibe.edu.cn' || !location.pathname.includes('/elective/grablessons')) throw new Error('请先在原站登录并进入选课轮次，再点击插件。');
  const vm = typeof grablessonsVue !== 'undefined' ? grablessonsVue : document.querySelector('#xsxkapp')?.__vue__;
  const client = typeof axios !== 'undefined' ? axios : null;
  if (!vm || !client || !vm.lcParam?.currentBatch?.code || !Object.keys(vm.studentInfo || {}).length) throw new Error('选课页面尚未准备好，请等待原站加载完成。');
  const fingerprint = async () => {
    const info = vm.studentInfo;
    const source = JSON.stringify(Object.keys(info).sort().map(k => [k, info[k]]));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('') + ':' + vm.lcParam.currentBatch.code + ':' + vm.currentCampus?.code;
  };
  const contextKey = await fingerprint();
  const main = vm.menuData?.menuList?.filter(m => String(m.displayName).replace(/\s/g, '') === '主修课程') || [];
  const context = {contextKey, mainType: main.length === 1 ? main[0].teachingClassType : null, campus: vm.currentCampus?.code, batch: vm.lcParam.currentBatch.code};
  if (command.kind === 'context') return context;
  if (command.kind !== 'page' || command.contextKey !== contextKey) throw new Error('账号、轮次或校区已变化，请重新同步。');
  if (!['all', 'main'].includes(command.scope) || !Number.isInteger(command.page) || command.page < 1 || command.page > 1000) throw new Error('无效查询。');
  if (command.scope === 'main' && (!context.mainType || !context.campus)) throw new Error('未找到主修分类或校区，请确认已进入选课页面。');
  const request = {teachingClassType: command.scope === 'all' ? 'ALLKC' : context.mainType, pageNumber: command.page, pageSize: 100, orderBy: ''};
  if (command.scope === 'main') request.campus = context.campus;
  const response = await client.post('/elective/clazz/list', request, {timeout: 20000});
  const payload = response.data;
  if (payload?.code != 200 || !Array.isArray(payload?.data?.rows)) throw new Error('原站没有返回有效课程数据，登录可能已失效。请回原站重新进入轮次。');
  if (await fingerprint() !== contextKey) throw new Error('同步期间账号或轮次发生变化，请重新同步。');
  const fields = ['JXBID','KCH','KXH','KCM','SKJS','KKDW','XF','KCXZ','KCLB','KCDZ','teachingPlace','teachingPlaceHide','numberOfSelected','classCapacity','KRL','YXRS','BKSKRL','BKSYXRS','schoolTerm'];
  function clean(row) {
    const out = Object.fromEntries(fields.filter(k => row[k] !== undefined).map(k => [k,row[k]]));
    out.SKSJ = Array.isArray(row.SKSJ) ? row.SKSJ.map(s => Object.fromEntries(['SKXQ','KSJC','JSJC','SKZC','SKZCMC','YPSJDD'].filter(k => s[k] !== undefined).map(k => [k,s[k]]))) : [];
    return out;
  }
  // Main lists may be grouped by course. Keep course and exact-class evidence separately.
  function membership(row) {
    const courseCodes = new Set(), classIds = new Set();
    function walk(value, depth) {
      if (!value || typeof value !== 'object' || depth > 5) return;
      if (value.KCH) courseCodes.add(String(value.KCH));
      if (value.JXBID) classIds.add(String(value.JXBID));
      for (const child of Object.values(value)) if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach(v => walk(v,depth+1)); else walk(child,depth+1);
      }
    }
    walk(row,0);
    return {courseCodes:[...courseCodes], classIds:[...classIds], key: String(row.JXBID || row.KCH || '')};
  }
  return {total: payload.data.total, rows: payload.data.rows.map(command.scope === 'all' ? clean : membership)};
}
