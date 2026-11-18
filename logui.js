/* Окно лога: кнопка 🐞 (или Ctrl+Shift+L). Собирает отчёт: срез состояния + вкладки + DOM + лог. */
(() => {
  const $ = s => document.querySelector(s);
  const view = $('#logview'), ta = $('#lv-text'), info = $('#lv-info');
  const clip = (v, n = 90) => { v = String(v ?? ''); return v.length > n ? v.slice(0, n) + '…' : v; };

  async function mergedEntries() {
    const st = await chrome.storage.local.get(['zlog_bg', 'zlog_clear']);
    const clearTs = st.zlog_clear || 0;
    const bg = (Array.isArray(st.zlog_bg) ? st.zlog_bg : []).filter(e => e.t >= clearTs);
    const ui = zlog.entries().filter(e => e.t >= clearTs);
    return [...ui, ...bg].sort((a, b) => a.t - b.t);
  }

  async function snapshot() {
    const L = [];
    const man = chrome.runtime.getManifest();
    L.push('Zen Sidebar v' + man.version + '   ' + new Date().toISOString());
    L.push('UA: ' + navigator.userAgent);
    L.push('Panel: ' + innerWidth + 'x' + innerHeight + ', dpr ' + devicePixelRatio + ', dark=' + matchMedia('(prefers-color-scheme: dark)').matches +
      ', reducedMotion=' + matchMedia('(prefers-reduced-motion: reduce)').matches);
    L.push('');
    try {
      const raw = (await chrome.storage.local.get('s')).s;
      const st = state(raw), ws = st.active;
      const all = await chrome.tabs.query({ currentWindow: true });
      const byId = new Map(all.map(t => [t.id, t]));
      L.push('--- STATE ---');
      L.push('active=' + ws + '  workspaces=' + st.workspaces.map(w => w.id + ':' + w.icon + w.name).join(', '));
      L.push('bind=' + JSON.stringify(st.bind));
      L.push('essentials:');
      st.essentials.forEach(p => L.push('  ' + pinLine(p, byId.get(Number(st.bind[p.id])))));
      for (const w of st.workspaces) {
        L.push('pins[' + w.id + ']:');
        (st.pins[w.id] || []).forEach(p => L.push('  ' + pinLine(p, byId.get(Number(st.bind[p.id])))));
      }
      L.push('');
      L.push('--- TABS (currentWindow) ---');
      all.forEach(t => L.push('  #' + t.id + ' idx=' + t.index + (t.active ? ' ACTIVE' : '') + ' ws=' + (st.map[t.id] ?? '-') +
        (Object.values(st.bind).map(Number).includes(t.id) ? ' PINNED' : '') + ' [' + t.status + '] ' + clip(t.pendingUrl || t.url, 110) + '  "' + clip(t.title, 40) + '"'));
    } catch (e) { L.push('snapshot error: ' + e.message); }
    L.push('');
    L.push('--- DOM ---');
    for (const id of ['essentials', 'pins', 'tabs', 'spaces']) {
      const el = document.getElementById(id);
      L.push('#' + id + ' (' + el.children.length + ')');
      [...el.children].forEach(c => L.push('  <' + c.tagName.toLowerCase() + ' data-id=' + (c.dataset.id ?? '-') + ' class="' + c.className + '"> ' + clip(c.textContent.trim(), 50) +
        (c.classList.contains('row') ? '  h=' + Math.round(c.getBoundingClientRect().height) : '')));
    }
    const hov = [...document.querySelectorAll('.zone-hover')].map(e => e.dataset.id);
    L.push('zone-hover: ' + (hov.length ? hov.join(',') : '-'));
    L.push('');
    return L.join('\n');
  }
  function pinLine(p, t) {
    const live = t ? (t.pendingUrl || t.url) : null;
    return p.id + ' "' + clip(p.title, 24) + '"  pin=' + clip(p.url, 70) + '  live=' + (t ? '#' + t.id + ' ' + clip(live, 70) : 'нет') +
      '  changed=' + (changed(p, t) ? 'ДА' : 'нет') + (t && t.active ? ' (active)' : '');
  }

  async function report() {
    const snap = await snapshot();
    const es = await mergedEntries();
    return snap + '--- LOG (' + es.length + ' строк; UI=панель, BG=фоновый скрипт) ---\n' + es.map(zlog.fmt).join('\n') + '\n';
  }

  async function open() {
    view.hidden = false;
    ta.value = 'собираю отчёт…';
    const text = await report();
    ta.value = text;
    info.textContent = text.split('\n').length + ' строк';
    ta.scrollTop = ta.scrollHeight;
    zlog.info('ui', 'лог открыт');
  }
  const close = () => { view.hidden = true; };
  const flash = (btn, txt) => { const o = btn.dataset.o || (btn.dataset.o = btn.textContent); btn.textContent = txt; setTimeout(() => { btn.textContent = o; }, 1400); };

  $('#logbtn').onclick = () => (view.hidden ? open() : close());
  $('#lv-close').onclick = close;
  $('#lv-refresh').onclick = open;
  $('#lv-copy').onclick = async e => {
    const text = await report(); ta.value = text;
    try { await navigator.clipboard.writeText(text); }
    catch { ta.focus(); ta.select(); document.execCommand('copy'); }
    zlog.info('ui', 'лог скопирован', { chars: text.length });
    flash(e.target, 'Скопировано ✓');
  };
  $('#lv-dl').onclick = async e => {
    const text = await report();
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })),
      download: 'zen-sidebar-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt'
    });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    zlog.info('ui', 'лог скачан', { chars: text.length });
    flash(e.target, 'Скачано ✓');
  };
  $('#lv-clear').onclick = async e => {
    zlog.clearLocal();
    await chrome.storage.local.set({ zlog_clear: Date.now() });
    zlog.info('ui', 'лог очищен');
    flash(e.target, 'Очищено ✓');
    open();
  };
  addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); view.hidden ? open() : close(); }
    else if (e.key === 'Escape' && !view.hidden) close();
  });
})();
