const $ = s => document.querySelector(s);
const DEF = { workspaces: [{ id: 'w1', name: 'Space 1', icon: '🏠' }], active: 'w1', map: {}, essentials: [], pins: {}, bind: {} };
let S, tabs = [], newTabMode = false, tempUrl = false, timer;
let prefs = { showTools: true, showUrl: true };
async function loadPrefs() { const r = await chrome.storage.local.get('prefs'); prefs = { ...prefs, ...(r.prefs || {}) }; applyPrefs(); }
function applyPrefs() {
  // Hide the whole header, not only its buttons: otherwise its min-height
  // leaves an empty strip above Essentials.
  $('.top').hidden = !prefs.showTools;
  $('#toptools').hidden = !prefs.showTools;
  $('#urlbar').hidden = !prefs.showUrl && !tempUrl;
  // Keep a divider only when at least one upper control is visible.
  $('#topsep').hidden = !prefs.showTools && !prefs.showUrl && !tempUrl;
}
async function savePref(key, value) { prefs[key] = value; await chrome.storage.local.set({ prefs }); applyPrefs(); zlog.info('settings', 'preference changed', { key, value }); }

function state(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  const workspaces = Array.isArray(x.workspaces) && x.workspaces.length
    ? x.workspaces.filter(w => w && typeof w.id === 'string')
    : DEF.workspaces.map(w => ({ ...w }));
  const ids = new Set(workspaces.map(w => w.id));
  return {
    workspaces,
    active: ids.has(x.active) ? x.active : workspaces[0].id,
    map: x.map && typeof x.map === 'object' ? x.map : {},
    essentials: Array.isArray(x.essentials) ? x.essentials : [],
    pins: x.pins && typeof x.pins === 'object' ? x.pins : {},
    bind: x.bind && typeof x.bind === 'object' ? x.bind : {}
  };
}
const sum = x => ({
  active: x.active, ws: x.workspaces.length, ess: x.essentials.length,
  pins: Object.fromEntries(Object.entries(x.pins).map(([k, v]) => [k, v.length])),
  bind: Object.keys(x.bind).length, map: Object.keys(x.map).length
});
const callerName = () => { const l = (new Error().stack || '').split('\n')[3] || ''; const m = l.match(/at (?:async )?([^\s(]+) \(/); return m ? m[1] : 'anon'; };
async function load() {
  const r = await chrome.storage.local.get('s'); S = state(r.s);
  zlog.debug('state', 'load', sum(S));
}
const mut = fn => {
  const label = callerName();
  return navigator.locks.request('zs-state', async () => {
    const t0 = performance.now();
    const r = await chrome.storage.local.get('s'), s = state(r.s);
    const before = state(JSON.parse(JSON.stringify(s)));
    await fn(s);
    S = state(s);
    const keys = Object.keys(S).filter(k => JSON.stringify(S[k]) !== JSON.stringify(before[k]));
    await chrome.storage.local.set({ s: S });
    const diff = {};
    keys.forEach(k => { diff[k] = S[k]; });
    zlog.info('state', 'mut ' + label + ' ' + Math.round(performance.now() - t0) + 'ms',
      { changedKeys: keys, before: sum(before), after: sum(S), new: keys.length ? diff : undefined });
  }).catch(e => { zlog.error('state', 'mut ' + label + ' FAILED', e); throw e; });
};
const uid = () => Math.random().toString(36).slice(2, 9);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const favOf = t => t?.favIconUrl || '';
const norm = u => (u || '').replace(/#.*$/, '').replace(/\/+$/, '');
const changed = (p, t) => !!t && norm(t.pendingUrl || t.url) !== norm(p.url);
function icon(url, title, cls = '') {
  if (url) {
    const i = new Image(); i.className = cls; i.src = url;
    i.onerror = () => i.replaceWith(letter(title)); return i;
  }
  return letter(title);
}
function letter(title) { const d = document.createElement('span'); d.className = 'fb'; d.textContent = (title || '?')[0].toUpperCase(); return d; }

// ---------- логирование состояния закрепов (только при изменении) ----------
const pinSig = new Map();
function logPin(kind, p, t) {
  const live = t ? (t.pendingUrl || t.url) : null;
  const d = {
    bound: S.bind[p.id] ?? null, live: !!t, active: !!(t && t.active),
    pinUrl: p.url, liveUrl: live, normPin: norm(p.url), normLive: live == null ? null : norm(live),
    changed: changed(p, t)
  };
  const sig = JSON.stringify(d);
  if (pinSig.get(p.id) === sig) return;
  pinSig.set(p.id, sig);
  zlog.info('pin', kind + ' ' + p.id + ' "' + String(p.title || '').slice(0, 28) + '" состояние изменилось', d);
}

// ---------- анимация: URL закреплённой вкладки изменился ----------
let prevChanged = null;
function markNewlyChanged() {
  const rows = [...document.querySelectorAll('.row.changed[data-id]')];
  const now = new Set(rows.map(r => r.dataset.id));
  if (prevChanged && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    rows.forEach(r => {
      if (prevChanged.has(r.dataset.id)) return;
      zlog.info('anim', 'URL закрепа изменился → анимация слэша', { id: r.dataset.id });
      r.querySelector('.slash')?.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 200, delay: 60, easing: 'ease-out', fill: 'backwards' });
      r.querySelector('.title')?.animate([{ transform: 'translateX(-12px)' }, { transform: 'none' }],
        { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }
  prevChanged = now;
}

// ---------- FLIP-анимация перестановки ----------
const ITEMS = '#essentials > [data-id], #pins > [data-id], #tabs > [data-id]';
function snapRects() {
  const m = new Map();
  document.querySelectorAll(ITEMS).forEach(el => {
    const r = el.getBoundingClientRect();
    m.set(el.dataset.id, { x: r.left, y: r.top });
  });
  return m;
}
function flip(prev) {
  if (!prev.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const els = [...document.querySelectorAll(ITEMS)];
  if (!els.some(el => prev.has(el.dataset.id))) return;
  let nNew = 0, nMoved = 0;
  els.forEach(el => {
    const o = prev.get(el.dataset.id);
    if (!o) {
      nNew++;
      el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 180, easing: 'ease-out' });
      return;
    }
    const r = el.getBoundingClientRect(), dx = o.x - r.left, dy = o.y - r.top;
    if (!dx && !dy) return;
    nMoved++;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
  if (nNew || nMoved) zlog.debug('anim', 'flip', { moved: nMoved, added: nNew, total: els.length });
}

async function render() {
  await load();
  tabs = await chrome.tabs.query({ currentWindow: true });
  const snap = snapRects();
  const cur = tabs.find(t => t.active);
  const bound = new Set(Object.values(S.bind).map(Number));
  const ws = S.workspaces.find(w => w.id === S.active) || S.workspaces[0];
  if (!ws) return;
  const liveOf = p => tabs.find(t => t.id === Number(S.bind[p.id]));
  if (document.activeElement !== $('#url')) $('#url').value = cur ? host(cur.pendingUrl || cur.url) || cur.title || '' : '';

  zlog.debug('render', 'render', { ws: ws.id, tabs: tabs.length, bound: bound.size, ess: S.essentials.length, pins: (S.pins[ws.id] || []).length });
  const es = $('#essentials'); es.replaceChildren();
  S.essentials.forEach(p => {
    const t = liveOf(p), b = document.createElement('button');
    logPin('ess', p, t);
    dnd(b, 'ess', p.id);
    b.className = 'tile' + (t?.active ? ' on' : '') + (t ? '' : ' dead') + (changed(p, t) ? ' changed' : '');
    b.title = t?.title || p.title; b.append(icon(p.fav, p.title, 'fav-lg')); b.onclick = () => openPin(p);
    b.oncontextmenu = e => menu(e, [
      ...(changed(p, t) ? [['Сбросить и закрепить вкладку', () => resetPin(p, t)]] : []),
      ['Заменить на текущий URL', () => repin('essentials', p)],
      ['Убрать из Essentials', () => unpin('essentials', p)],
      ...(t ? [['Закрыть вкладку', () => chrome.tabs.remove(t.id), 1]] : [])
    ]);
    es.append(b);
  });

  const pins = S.pins[ws.id] || [], pe = $('#pins'); pe.replaceChildren();
  pins.forEach(p => { logPin('pin', p, liveOf(p)); pe.append(row({
    dnd: ['pin', p.id],
    title: liveOf(p)?.title || p.title, fav: favOf(liveOf(p)) || p.fav, on: liveOf(p)?.active, dead: !liveOf(p),
    changed: changed(p, liveOf(p)), reset: changed(p, liveOf(p)) ? () => resetPin(p, liveOf(p)) : null,
    click: () => openPin(p), close: liveOf(p) ? () => chrome.tabs.remove(liveOf(p).id) : null,
    menu: e => menu(e, [
      ...(changed(p, liveOf(p)) ? [['Сбросить и закрепить вкладку', () => resetPin(p, liveOf(p))]] : []),
      ['Заменить на текущий URL', () => repin('pins', p)], ['Открепить', () => unpin('pins', p)],
      ['Добавить в Essentials', () => toEssentials(p)],
      ...(liveOf(p) ? [['Закрыть вкладку', () => chrome.tabs.remove(liveOf(p).id), 1]] : [])
    ])
  })); });
  $('#pinsep').hidden = !pins.length;

  const tl = $('#tabs'); tl.replaceChildren();
  tabs.filter(t => !bound.has(t.id) && (S.map[t.id] || S.workspaces[0].id) === ws.id).forEach(t => tl.append(row({
    dnd: ['tab', t.id],
    title: t.title || t.pendingUrl || t.url || 'Новая вкладка', fav: favOf(t), on: t.active, dead: t.status !== 'complete',
    click: () => chrome.tabs.update(t.id, { active: true }), close: () => chrome.tabs.remove(t.id),
    menu: e => menu(e, [
      ['Закрепить в Pinned', () => pinTab(t, 'pins')], ['Добавить в Essentials', () => pinTab(t, 'essentials')],
      ['Дублировать', () => chrome.tabs.duplicate(t.id)], ['Закрыть другие', () => closeOthers(t, ws.id, bound), 1],
      ['Закрыть', () => chrome.tabs.remove(t.id), 1]
    ])
  })));

  const sp = $('#spaces'); sp.replaceChildren();
  S.workspaces.forEach(w => {
    const b = document.createElement('button'); b.className = 'sp' + (w.id === ws.id ? ' on' : '');
    b.textContent = w.icon; b.title = w.name; b.onclick = () => switchWs(w.id);
    b.oncontextmenu = e => menu(e, [['Переименовать', () => renameWs(w)], ['Сменить иконку', () => iconWs(w)],
      ...(S.workspaces.length > 1 ? [['Удалить Workspace', () => delWs(w), 1]] : [])]);
    sp.append(b);
  });
  const add = document.createElement('button'); add.className = 'sp add'; add.textContent = '+'; add.title = 'Новый Workspace'; add.onclick = addWs; sp.append(add);
  zlog.debug('render', 'done', { ess: es.children.length, pins: pe.children.length, tabs: tl.children.length, changedRows: document.querySelectorAll('.row.changed').length });
  flip(snap);
  markNewlyChanged();
}
function row({ title, fav, on, dead, changed: ch, reset, click, close, menu: m, dnd: d }) {
  const r = document.createElement('div'), rid = d ? d[1] : null;
  if (d) dnd(r, d[0], d[1]);
  r.className = 'row' + (on ? ' on' : '') + (dead ? ' dead' : '') + (ch ? ' changed' : '');
  const box = document.createElement('span'); box.className = 'tt' + (ch ? ' has-slash' : '');
  if (ch) { const sl = document.createElement('i'); sl.className = 'slash'; sl.textContent = '/'; box.append(sl); }
  const t = document.createElement('span'); t.className = 'title'; t.textContent = title; box.append(t);
  if (ch) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = 'Вернуться к закреплённой'; box.append(sub); }
  const favicon = icon(fav, title);
  favicon.classList.add('favicon');
  if (reset) {
    // зона «вернуть к закреплённой»: от левого края строки до слэша (иконка + отступ + слэш)
    const z = document.createElement('span');
    z.className = 'reset-zone'; z.title = 'Вернуться к закреплённой вкладке';
    z.onclick = e => { e.stopPropagation(); zlog.info('ui', 'reset-zone click', { id: rid, title }); reset(); };
    z.onmouseenter = () => { r.classList.add('zone-hover'); zlog.debug('hover', 'reset-zone enter', { id: rid }); };
    z.onmouseleave = () => { r.classList.remove('zone-hover'); zlog.debug('hover', 'reset-zone leave', { id: rid }); };
    r.append(z);
  }
  r.append(favicon, box);
  if (reset) {
    const b = document.createElement('button');
    b.className = 'x reset';
    b.title = 'Сбросить и закрепить вкладку';
    b.onclick = e => { e.stopPropagation(); zlog.info('ui', 'reset-minus click', { id: rid, title }); reset(); };
    r.append(b);
  }
  if (!ch && close) {
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕';
    x.onclick = e => { e.stopPropagation(); zlog.info('ui', 'close click', { id: rid, title }); close(); };
    r.append(x);
  }
  r.onclick = e => { zlog.info('ui', 'row click', { kind: d && d[0], id: rid, title, target: e.target }); return click(e); };
  r.oncontextmenu = m; return r;
}
const schedule = why => { zlog.debug('render', 'schedule', { why: typeof why === 'string' ? why : undefined }); clearTimeout(timer); timer = setTimeout(render, 40); };

// ---------- drag & drop ----------
let drag = null, lastMark = '';
const dl = Object.assign(document.createElement('div'), { id: 'dropline', hidden: true });
document.body.append(dl);

function dnd(el, kind, id) {
  el.draggable = true;
  el.dataset.id = String(id);
  el.ondragstart = e => {
    drag = { kind, id: String(id), band: $('#newtab').getBoundingClientRect().top, dropped: false };
    lastMark = '';
    zlog.info('dnd', 'dragstart', { kind, id: String(id) });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', kind + ':' + id);
    setTimeout(() => {
      el.classList.add('lifted');
      document.body.classList.add('dragging-any');
      if (kind !== 'tab') document.body.classList.add('show-empty');
    }, 0);
  };
  el.ondragend = endDrag;
}

function clearMarks() {
  dl.hidden = true;
  document.querySelectorAll('.drop-empty').forEach(n => n.classList.remove('drop-empty'));
}
function endDrag(e) {
  // Some Chromium builds occasionally emit dragend without a matching drop.
  // Recover a tab reorder from the final pointer position when it is still
  // inside the tabs list; normal drop events always take precedence.
  const d = drag;
  if (d && !d.dropped && d.kind === 'tab' && e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
    const c = $('#tabs'), r = c.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const pos = place(c, e);
      d.dropped = true;
      zlog.warn('dnd', 'drop recovered from dragend', { zone: 'tabs', index: pos.index, ref: pos.ref });
      drop('tabs', pos);
    }
  }
  if (d) zlog.info('dnd', 'end', { kind: d.kind, id: d.id });
  drag = null; lastMark = '';
  clearMarks();
  document.body.classList.remove('dragging-any', 'show-empty');
  document.querySelectorAll('.lifted').forEach(n => n.classList.remove('lifted'));
  schedule('endDrag');
}
document.addEventListener('dragend', endDrag);

function place(c, e) {
  const kids = [...c.children], grid = c.id === 'essentials';
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (grid
      ? (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2))
      : e.clientY < r.top + r.height / 2) {
      return { index: i, ref: kids[i] };
    }
  }
  return { index: kids.length, ref: null };
}
function showLine(c, pos) {
  const wasHidden = dl.hidden;
  clearMarks();
  const mark = c.id + ':' + pos.index;
  if (mark !== lastMark) { lastMark = mark; zlog.debug('dnd', 'target', { zone: c.id, index: pos.index, ref: pos.ref }); }
  const ref = pos.ref;
  const last = c.lastElementChild;
  if (!ref && !last) {
    c.classList.add('drop-empty');
    return;
  }
  const r = (ref || last).getBoundingClientRect(), grid = c.id === 'essentials';
  dl.hidden = false;
  dl.className = grid ? 'v' : '';
  const px = n => Math.round(n) + 'px';
  if (grid) Object.assign(dl.style, {
    left: px(ref ? r.left - 3 : r.right + 3), top: px(r.top),
    height: px(r.height), width: '2px'
  });
  else Object.assign(dl.style, {
    left: px(r.left), top: px(ref ? r.top - 1 : r.bottom + 1),
    width: px(r.width), height: '2px'
  });
  if (wasHidden) { dl.classList.add('snap'); void dl.offsetWidth; dl.classList.remove('snap'); }
}
function fallbackZone(e) {
  const candidates = drag.kind === 'tab'
    ? [['tabs', $('#tabs')]]
    : [['ess', $('#essentials')], ['pins', $('#pins')], ['tabs', $('#tabs')]];
  let best = null, distance = Infinity;
  for (const [zone, el] of candidates) {
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
    if (d < distance) { distance = d; best = [zone, el]; }
  }
  return best;
}
function zoneDrop(c, zone) {
  c.ondragover = e => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showLine(c, place(c, e));
  };
  c.ondragleave = e => { if (!c.contains(e.relatedTarget)) clearMarks(); };
}

// Chromium can occasionally dispatch dragend without delivering drop to the
// nested list handler (especially when the pointer crosses child rows). Keep
// the drag operation valid at document level and resolve the destination once,
// in capture phase, instead of relying on a particular row/container target.
document.addEventListener('dragover', e => {
  if (!drag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (drag.kind === 'tab') document.body.classList.toggle('show-empty', e.clientY < drag.band);
  const hit = e.target.closest('#essentials,#pins,#tabs');
  const zone = hit
    ? [hit.id === 'essentials' ? 'ess' : hit.id, hit]
    : fallbackZone(e);
  if (!zone) { clearMarks(); return; }
  showLine(zone[1], place(zone[1], e));
}, true);

document.addEventListener('drop', e => {
  if (!drag) return;
  e.preventDefault();
  drag.dropped = true;
  const hit = e.target.closest('#essentials,#pins,#tabs');
  const zone = hit
    ? [hit.id === 'essentials' ? 'ess' : hit.id, hit]
    : fallbackZone(e);
  if (zone) {
    const pos = place(zone[1], e);
    clearMarks();
    zlog.info('dnd', 'drop resolved', { zone: zone[0], index: pos.index, ref: pos.ref });
    drop(zone[0], pos);
  } else {
    zlog.warn('dnd', 'drop ignored: no destination');
  }
  setTimeout(endDrag, 0);
}, true);

async function drop(zone, pos) {
  const d = drag;
  if (!d) return;
  let moveTab = null;
  await mut(s => {
    const ws = s.active;
    const list = z => z === 'ess' ? s.essentials : (s.pins[ws] ||= []);
    let item = null, tabId = null;

    if (d.kind === 'tab') {
      tabId = Number(d.id);
      const t = tabs.find(x => x.id === tabId);
      if (!t) return;
      if (zone !== 'tabs') item = {
        id: uid(),
        url: t.pendingUrl || t.url || 'about:blank',
        title: t.title || host(t.url) || 'Новая вкладка',
        fav: favOf(t)
      };
    } else {
      const src = s.essentials.some(p => p.id === d.id) ? 'ess' : 'pins';
      const sourceList = list(src);
      const si = sourceList.findIndex(p => p.id === d.id);
      if (si < 0) return;
      item = sourceList[si];
      tabId = s.bind[item.id] ?? null;
      sourceList.splice(si, 1);
      if (src === zone && si < pos.index) pos = { ...pos, index: pos.index - 1 };
    }

    if (zone === 'tabs') {
      if (item) {
        delete s.bind[item.id];
        if (tabId != null) s.map[tabId] = ws;
      }
      moveTab = tabId;
    } else {
      list(zone).splice(Math.max(0, pos.index), 0, item);
      if (d.kind === 'tab') s.bind[item.id] = tabId;
    }
  });
  zlog.info('dnd', 'drop result', { zone, kind: d.kind, id: d.id, moveTab, index: pos.index });
  if (moveTab != null) await moveTo(moveTab, pos.ref);
}

async function moveTo(id, ref) {
  tabs = await chrome.tabs.query({ currentWindow: true });
  const src = tabs.find(t => t.id === id);
  if (!src) return;
  let target;
  if (ref) {
    const r = tabs.find(t => t.id === Number(ref.dataset.id));
    if (!r || r.id === id) return;
    target = src.index < r.index ? r.index - 1 : r.index;
  } else {
    const kids = [...$('#tabs').children].filter(k => Number(k.dataset.id) !== id);
    const last = kids.length && tabs.find(t => t.id === Number(kids[kids.length - 1].dataset.id));
    if (!last) return;
    target = src.index < last.index ? last.index : last.index + 1;
  }
  zlog.info('dnd', 'tabs.move', { id, from: src.index, to: target });
  await chrome.tabs.move(id, { index: target }).catch(e => console.warn('tabs.move:', e.message));
}

zoneDrop($('#essentials'), 'ess');
zoneDrop($('#pins'), 'pins');
zoneDrop($('#tabs'), 'tabs');

async function openPin(p) {
  await load(); const id = Number(S.bind[p.id]);
  zlog.info('pin', 'openPin', { pin: p.id, boundTab: id || null, url: p.url });
  if (id) { try { await chrome.tabs.update(id, { active: true }); return; } catch (e) { zlog.warn('pin', 'привязанная вкладка не найдена → отвязываем', { pin: p.id, tab: id, err: e }); await mut(s => { delete s.bind[p.id]; }); } }
  const url = p.url || 'about:blank', t = await chrome.tabs.create({ url });
  await mut(s => { s.bind[p.id] = t.id; s.map[t.id] = s.active; });
}
async function pinTab(t, kind) {
  const p = { id: uid(), url: t.pendingUrl || t.url || 'about:blank', title: t.title || host(t.url) || 'Новая вкладка', fav: favOf(t) };
  await mut(s => { if (kind === 'pins') (s.pins[s.active] ||= []).push(p); else s.essentials.push(p); s.bind[p.id] = t.id; });
}
async function resetPin(p, t) {
  zlog.info('pin', 'resetPin', { pin: p.id, tab: t && t.id, to: p.url, from: t && (t.pendingUrl || t.url) });
  if (t) await chrome.tabs.update(t.id, { url: p.url });
  else zlog.warn('pin', 'resetPin: нет живой вкладки', { pin: p.id });
}
async function toEssentials(p) {
  await mut(s => {
    if (s.essentials.some(e => e.url === p.url)) return;
    const copy = { ...p, id: uid() }; s.essentials.push(copy);
    if (s.bind[p.id] != null) s.bind[copy.id] = s.bind[p.id];
  });
}
async function unpin(kind, p) { await mut(s => { if (kind === 'essentials') s.essentials = s.essentials.filter(x => x.id !== p.id); else s.pins[s.active] = (s.pins[s.active] || []).filter(x => x.id !== p.id); delete s.bind[p.id]; }); }
async function repin(kind, p) {
  const [cur] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!cur) return;
  await mut(s => { const list = kind === 'essentials' ? s.essentials : (s.pins[s.active] || []), x = list.find(i => i.id === p.id); if (x) Object.assign(x, { url: cur.pendingUrl || cur.url || 'about:blank', title: cur.title, fav: favOf(cur) }); });
}
async function closeOthers(keep, wsId, bound) {
  const ids = tabs.filter(t => t.id !== keep.id && !bound.has(t.id) && (S.map[t.id] || S.workspaces[0].id) === wsId).map(t => t.id);
  if (ids.length) await chrome.tabs.remove(ids);
}
async function switchWs(id) {
  if (!S.workspaces.some(w => w.id === id)) return;
  await mut(s => { s.active = id; });
  tabs = await chrome.tabs.query({ currentWindow: true });
  const bound = new Set(Object.values(S.bind).map(Number));
  const t = tabs.filter(x => !bound.has(x.id) && (S.map[x.id] || S.workspaces[0].id) === id).sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
  if (t) await chrome.tabs.update(t.id, { active: true });
  else { const n = await chrome.tabs.create({}); if (n.id != null) await mut(s => { s.map[n.id] = id; }); }
}
async function addWs() {
  const name = prompt('Название Workspace', 'Space ' + (S.workspaces.length + 1)); if (!name) return;
  const icon = prompt('Эмодзи-иконка', '🚀') || '🚀', id = 'w' + uid();
  await mut(s => s.workspaces.push({ id, name, icon })); await switchWs(id);
}
async function renameWs(w) { const n = prompt('Название', w.name); if (n) await mut(s => { const x = s.workspaces.find(x => x.id === w.id); if (x) x.name = n; }); }
async function iconWs(w) { const n = prompt('Эмодзи', w.icon); if (n) await mut(s => { const x = s.workspaces.find(x => x.id === w.id); if (x) x.icon = n; }); }
async function delWs(w) {
  if (S.workspaces.length <= 1 || !confirm(`Удалить «${w.name}»? Вкладки переедут в первый Workspace.`)) return;
  await mut(s => {
    const oldPins = s.pins[w.id] || [], fallback = s.workspaces.find(x => x.id !== w.id);
    for (const p of oldPins) delete s.bind[p.id];
    s.workspaces = s.workspaces.filter(x => x.id !== w.id);
    for (const k in s.map) if (s.map[k] === w.id) s.map[k] = fallback.id;
    delete s.pins[w.id];
    if (s.active === w.id) s.active = fallback.id;
  });
}
function menu(e, items) {
  e.preventDefault(); const m = $('#menu'); m.replaceChildren();
  zlog.info('ui', 'contextmenu', { labels: items.map(i => i[0]), target: e.target });
  items.forEach(([label, fn, danger]) => { const b = document.createElement('button'); b.textContent = label; if (danger) b.className = 'danger'; b.onclick = () => { zlog.info('ui', 'menu choose', { label }); m.hidden = true; Promise.resolve(fn()).catch(console.error); }; m.append(b); });
  m.hidden = false; m.style.left = Math.max(6, Math.min(e.clientX, innerWidth - m.offsetWidth - 6)) + 'px'; m.style.top = Math.max(6, Math.min(e.clientY, innerHeight - m.offsetHeight - 6)) + 'px';
}
addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });

const urlIn = $('#url');
urlIn.onfocus = async () => { zlog.debug('url', 'focus', { newTabMode });
   const [c] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!newTabMode && c) urlIn.value = c.pendingUrl || c.url || ''; urlIn.select(); };
urlIn.onblur = () => { zlog.debug('url', 'blur'); newTabMode = false; tempUrl = false; applyPrefs(); schedule('urlblur'); };
urlIn.onkeydown = async e => {
  if (e.key === 'Escape') return urlIn.blur();
  if (e.key !== 'Enter') return;
  zlog.info('url', 'enter', { value: urlIn.value, newTabMode });
  const v = urlIn.value.trim(); if (!v) return;
  const isUrl = /^[a-z]+:\/\//i.test(v) || (/^[^\s]+\.[^\s]{2,}$/.test(v)), url = isUrl ? (/^[a-z]+:\/\//i.test(v) ? v : 'https://' + v) : null;
  if (url) { if (newTabMode) await chrome.tabs.create({ url }); else { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (t) await chrome.tabs.update(t.id, { url }); } }
  else await chrome.search.query({ text: v, disposition: newTabMode ? 'NEW_TAB' : 'CURRENT_TAB' });
  zlog.info('url', 'submit done', { value: v });
  urlIn.blur();
};
$('#newtab').onclick = () => {
  zlog.info('ui', 'новая вкладка (поле адреса)', { tempUrl: !prefs.showUrl });
  newTabMode = true;
  // Адресная строка отключена — показываем её временно; после ввода или потери фокуса она снова скрывается.
  if (!prefs.showUrl) { tempUrl = true; applyPrefs(); }
  urlIn.value = '';
  urlIn.focus();
};
$('#back').onclick = async () => { zlog.info('ui', 'back'); const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (t) chrome.tabs.goBack(t.id).catch(() => {}); };
$('#fwd').onclick = async () => { zlog.info('ui', 'fwd'); const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (t) chrome.tabs.goForward(t.id).catch(() => {}); };
$('#reload').onclick = async () => { zlog.info('ui', 'reload'); const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (t) chrome.tabs.reload(t.id); };

const tabLog = (name, f) => (...a) => { zlog.debug('tabs', name, f(...a)); schedule(name); };
chrome.tabs.onCreated.addListener(tabLog('onCreated', t => zlog.tab(t)));
chrome.tabs.onRemoved.addListener(tabLog('onRemoved', (id, info) => ({ id, info })));
chrome.tabs.onUpdated.addListener((id, ci, t) => {
  zlog.debug('tabs', 'onUpdated', { id, ci, url: t && t.url, pending: t && t.pendingUrl });
  // Не перестраиваем весь sidebar из-за каждого изменения favicon.
  // Некоторые сайты (например, Claude.ai) часто меняют favicon во время генерации.
  // Это уничтожало наведённые DOM-строки и вызывало мерцание hover у всех вкладок.
  if (ci.url || ci.title || ci.status) schedule('onUpdated:' + Object.keys(ci).join(','));
});
chrome.tabs.onActivated.addListener(tabLog('onActivated', info => info));
chrome.tabs.onMoved.addListener(tabLog('onMoved', (id, info) => ({ id, info })));
chrome.tabs.onAttached.addListener(tabLog('onAttached', (id, info) => ({ id, info })));
chrome.tabs.onDetached.addListener(tabLog('onDetached', (id, info) => ({ id, info })));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.prefs) {
    prefs = { showTools: true, showUrl: true, ...(ch.prefs.newValue || {}) };
    applyPrefs();
    zlog.info('settings', 'preferences applied live', prefs);
  }
  if (ch.s) { zlog.debug('storage', 's изменён (другим контекстом или нами)', { keys: Object.keys(ch) }); schedule('storage'); }
});
document.addEventListener('visibilitychange', () => zlog.debug('window', 'visibility', { state: document.visibilityState }));
addEventListener('focus', () => zlog.debug('window', 'focus'));
addEventListener('blur', () => zlog.debug('window', 'blur'));
addEventListener('resize', () => zlog.debug('window', 'resize', { w: innerWidth, h: innerHeight }));

// трассировка вызовов основных функций (аргументы, длительность, ошибки)
['render', 'openPin', 'pinTab', 'resetPin', 'toEssentials', 'unpin', 'repin', 'closeOthers',
  'switchWs', 'addWs', 'renameWs', 'iconWs', 'delWs', 'drop', 'moveTo'
].forEach(n => { window[n] = zlog.trace(n, window[n]); });

zlog.info('boot', 'панель запущена', { version: chrome.runtime.getManifest().version, w: innerWidth, h: innerHeight, dark: matchMedia('(prefers-color-scheme: dark)').matches });
loadPrefs().then(() => render()).catch(console.error);
