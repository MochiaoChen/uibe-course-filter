import {readPage} from './reader.js';
chrome.action.onClicked.addListener(tab => {
  chrome.tabs.create({url: chrome.runtime.getURL('index.html') + (tab?.id ? '?sourceTab=' + tab.id : '')});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('index.html')) || message?.type !== 'read') return;
  (async () => {
    if (!Number.isInteger(message.tabId)) throw new Error('请在原站选课页面点击插件图标后再同步。');
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url?.startsWith('https://bkxk.uibe.edu.cn/xsxk/elective/grablessons')) throw new Error('请在原站登录、进入选课轮次，再点击插件图标。');
    const result = await chrome.scripting.executeScript({target:{tabId:message.tabId}, world:'MAIN', func:readPage, args:[message.command]});
    if (!result[0]?.result) throw new Error('读取失败，请重新打开选课页面。');
    return result[0].result;
  })().then(data => reply({data}), error => reply({error: error.message}));
  return true;
});
