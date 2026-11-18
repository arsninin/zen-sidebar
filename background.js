importScripts('log.js');
zlog.info('bg', 'service worker запущен', { version: chrome.runtime.getManifest().version });

const DEF = {
  workspaces: [{ id: 'w1', name: 'Space 1', icon: '🏠' }],
  active: 'w1',
  map: {},
  essentials: [],
  pins: {},
  bind: {}
};

function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const workspaces = Array.isArray(s.workspaces) && s.workspaces.length
    ? s.workspaces.filter(w => w && typeof w.id === 'string')
    : DEF.workspaces.map(w => ({ ...w }));
  const ids = new Set(workspaces.map(w => w.id));
  const active = ids.has(s.active) ? s.active : workspaces[0].id;
  return {
    workspaces,
    active,
    map: s.map && typeof s.map === 'object' ? s.map : {},
    essentials: Array.isArray(s.essentials) ? s.essentials : [],
    pins: s.pins && typeof s.pins === 'object' ? s.pins : {},
    bind: s.bind && typeof s.bind === 'object' ? s.bind : {}
  };
}

const sum = s => ({
  active: s.active, ws: s.workspaces.length, ess: s.essentials.length,
  pins: Object.fromEntries(Object.entries(s.pins).map(([k, v]) => [k, v.length])),
  bind: Object.keys(s.bind).length, map: Object.keys(s.map).length
});
const mut = (fn, label = 'mut') => navigator.locks.request('zs-state', async () => {
  const t0 = performance.now();
  const r = await chrome.storage.local.get('s');
  const S = normalizeState(r.s);
  const before = JSON.stringify(S);
  const beforeSum = sum(S);
  await fn(S);
  const out = normalizeState(S);
  const changedKeys = Object.keys(out).filter(k => JSON.stringify(out[k]) !== JSON.stringify(normalizeState(JSON.parse(before))[k]));
  await chrome.storage.local.set({ s: out });
  zlog.info('state', 'bg mut ' + label + ' ' + Math.round(performance.now() - t0) + 'ms',
    { changedKeys, before: beforeSum, after: sum(out) });
}).catch(e => { zlog.error('state', 'bg mut ' + label + ' FAILED', e); throw e; });

async function syncTabs() {
  const tabs = await chrome.tabs.query({});
  zlog.info('bg', 'syncTabs', { tabs: tabs.length });
  await mut(S => {
    for (const tab of tabs) {
      if (tab.id != null && S.map[tab.id] == null) S.map[tab.id] = S.active;
    }
  }, 'syncTabs');
}

chrome.runtime.onInstalled.addListener(async details => {
  zlog.info('bg', 'onInstalled', details);
  // Настройки доступны из контекстного меню самой иконки расширения.
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: 'zen-sidebar-settings',
    title: 'Настройки Zen Sidebar',
    contexts: ['action']
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await syncTabs();
});
chrome.runtime.onStartup.addListener(() => { zlog.info('bg', 'onStartup'); return syncTabs(); });

chrome.tabs.onCreated.addListener(tab => {
  zlog.info('tabs', 'onCreated', zlog.tab(tab));
  return mut(S => {
    if (tab.id != null) S.map[tab.id] = S.map[tab.id] || S.active;
  }, 'onCreated');
});

// URL/title закреплённых вкладок: пишем только значимые изменения
chrome.tabs.onUpdated.addListener((id, ci, tab) => {
  if (ci.url || ci.title || ci.status === 'complete') zlog.debug('tabs', 'onUpdated', { id, ci, url: tab.url });
});

chrome.tabs.onRemoved.addListener((id, info) => {
  zlog.info('tabs', 'onRemoved', { id, info });
  return mut(S => {
    delete S.map[id];
    for (const k in S.bind) if (S.bind[k] === id) { zlog.info('bg', 'unbind pin (tab closed)', { pin: k, tab: id }); delete S.bind[k]; }
  }, 'onRemoved');
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  zlog.debug('tabs', 'onActivated', { tabId });
  return mut(S => {
    const bound = Object.values(S.bind).includes(tabId);
    const ws = S.map[tabId];
    zlog.debug('bg', 'activated tab', { tabId, bound, ws, active: S.active });
    if (!bound && ws && S.workspaces.some(w => w.id === ws)) S.active = ws;
  }, 'onActivated');
});

chrome.commands.onCommand.addListener(cmd => { zlog.info('bg', 'command', { cmd }); return mut(async S => {
  if (cmd !== 'next-workspace' && cmd !== 'prev-workspace') return;
  const n = S.workspaces.length;
  if (!n) return;
  let i = S.workspaces.findIndex(w => w.id === S.active);
  if (i < 0) i = 0;
  const step = cmd === 'next-workspace' ? 1 : -1;
  const j = (i + step + n) % n;
  S.active = S.workspaces[j].id;
  const all = await chrome.tabs.query({ currentWindow: true });
  const t = all
    .filter(x => S.map[x.id] === S.active)
    .sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
  zlog.info('bg', 'workspace switch by command', { to: S.active, tab: t && t.id });
  if (t) await chrome.tabs.update(t.id, { active: true });
}, 'command:' + cmd); });

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'zen-sidebar-settings') {
    chrome.runtime.openOptionsPage();
  }
});
