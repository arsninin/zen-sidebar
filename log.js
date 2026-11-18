/* Zen Sidebar — логгер. Работает и в панели (window), и в service worker (self).
   Кольцевой буфер в памяти + сохранение в chrome.storage.local (переживает закрытие панели). */
(() => {
  const G = typeof window !== 'undefined' ? window : self;
  const SRC = typeof window !== 'undefined' ? 'panel' : 'bg';
  const KEY = 'zlog_' + SRC;
  const MAX = 4000;
  const LV = { debug: 0, info: 1, warn: 2, error: 3 };
  const buf = [];
  let saveTimer = null, calls = 0;

  const orig = {
    log: console.log.bind(console), info: console.info.bind(console),
    warn: console.warn.bind(console), error: console.error.bind(console)
  };

  // ---- безопасная сериализация (усечение, DOM, Error, циклы) ----
  function ser(v, depth = 0, seen = new WeakSet()) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…(' + v.length + ')' : v;
    if (typeof v === 'function') return '[fn ' + (v.name || 'anon') + ']';
    if (typeof v === 'symbol' || typeof v === 'bigint') return String(v);
    if (typeof Element !== 'undefined' && v instanceof Element) {
      const id = v.dataset && v.dataset.id ? '[data-id=' + v.dataset.id + ']' : (v.id ? '#' + v.id : '');
      const cls = typeof v.className === 'string' && v.className ? '.' + v.className.trim().split(/\s+/).join('.') : '';
      return '<' + v.tagName.toLowerCase() + id + cls + '>';
    }
    if (typeof Event !== 'undefined' && v instanceof Event) {
      return { event: v.type, x: v.clientX, y: v.clientY, target: ser(v.target, depth + 1, seen) };
    }
    if (v instanceof Error) return { error: v.name + ': ' + v.message, stack: String(v.stack || '').split('\n').slice(0, 5).join(' | ') };
    if (typeof v !== 'object') return String(v);
    if (seen.has(v)) return '[circular]';
    if (depth >= 4) return Array.isArray(v) ? '[array ' + v.length + ']' : '[object]';
    seen.add(v);
    if (v instanceof Set) return { set: [...v].slice(0, 12).map(x => ser(x, depth + 1, seen)) };
    if (v instanceof Map) return { map: [...v].slice(0, 12).map(([k, x]) => [ser(k, depth + 1, seen), ser(x, depth + 1, seen)]) };
    if (Array.isArray(v)) {
      const o = v.slice(0, 10).map(x => ser(x, depth + 1, seen));
      if (v.length > 10) o.push('…+' + (v.length - 10));
      return o;
    }
    const out = {}; let n = 0;
    for (const k of Object.keys(v)) {
      if (n++ >= 16) { out['…'] = '+' + (Object.keys(v).length - 16) + ' keys'; break; }
      try { out[k] = ser(v[k], depth + 1, seen); } catch { out[k] = '[unreadable]'; }
    }
    return out;
  }
  const json = d => {
    if (d === undefined) return '';
    try { const s = JSON.stringify(ser(d)); return s.length > 900 ? s.slice(0, 900) + '…' : s; } catch { return '[unserializable]'; }
  };

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { chrome.storage.local.set({ [KEY]: buf.slice(-MAX) }).catch(() => {}); } catch {}
    }, 300);
  }

  function push(level, tag, msg, data) {
    const e = { t: Date.now(), s: SRC, l: level, g: tag, m: String(msg) };
    if (data !== undefined) e.d = json(data);
    buf.push(e);
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    scheduleSave();
    return e;
  }

  const api = {
    SRC, KEY, ser, json,
    debug: (tag, msg, data) => push('debug', tag, msg, data),
    info: (tag, msg, data) => push('info', tag, msg, data),
    warn: (tag, msg, data) => push('warn', tag, msg, data),
    error: (tag, msg, data) => push('error', tag, msg, data),
    entries: () => buf.slice(),
    clearLocal() { buf.length = 0; scheduleSave(); },
    tab: t => t ? { id: t.id, idx: t.index, act: t.active, st: t.status, url: t.pendingUrl || t.url, title: (t.title || '').slice(0, 40) } : null,
    fmt(e) {
      const d = new Date(e.t), p = (n, w = 2) => String(n).padStart(w, '0');
      const ts = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
      return ts + ' ' + (e.s === 'bg' ? 'BG' : 'UI') + ' ' + e.l.toUpperCase().padEnd(5) + ' [' + e.g + '] ' + e.m + (e.d ? ' ' + e.d : '');
    },
    // обернуть функцию: логирует вызов, аргументы, длительность, результат/ошибку
    trace(name, fn, tag = 'call') {
      return function (...args) {
        const id = ++calls, t0 = performance.now();
        push('debug', tag, '#' + id + ' ' + name + ' →', args.length ? args : undefined);
        const done = (ok, extra) => push(ok ? 'debug' : 'error', tag,
          '#' + id + ' ' + name + (ok ? ' ✓ ' : ' ✗ ') + Math.round(performance.now() - t0) + 'ms', extra);
        let r;
        try { r = fn.apply(this, args); } catch (e) { done(false, e); throw e; }
        if (r && typeof r.then === 'function') return r.then(v => { done(true); return v; }, e => { done(false, e); throw e; });
        done(true);
        return r;
      };
    }
  };
  G.zlog = api;

  // ---- перехват console.warn/error и глобальных ошибок ----
  console.warn = (...a) => { orig.warn(...a); push('warn', 'console', a.map(x => typeof x === 'string' ? x : json(x)).join(' ')); };
  console.error = (...a) => { orig.error(...a); push('error', 'console', a.map(x => typeof x === 'string' ? x : json(x)).join(' ')); };
  G.addEventListener('error', e => push('error', 'uncaught', e.message || 'error', { file: e.filename, line: e.lineno, col: e.colno, stack: e.error && e.error.stack }));
  G.addEventListener('unhandledrejection', e => push('error', 'unhandled-promise', e.reason && e.reason.message ? e.reason.message : String(e.reason), e.reason));

  // ---- восстановить прошлую сессию из storage ----
  push('info', 'boot', '=== новая сессия (' + SRC + ') ===', { ua: (G.navigator && navigator.userAgent) || '' });
  try {
    chrome.storage.local.get(KEY).then(r => {
      const old = Array.isArray(r[KEY]) ? r[KEY] : [];
      if (!old.length) return;
      const cur = buf.splice(0, buf.length);
      buf.push(...old, ...cur);
      if (buf.length > MAX) buf.splice(0, buf.length - MAX);
      scheduleSave();
    }).catch(() => {});
  } catch {}
})();
