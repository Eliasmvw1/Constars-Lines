import { StudioRecorder, trimWav } from './recorder.js';

const CFG = window.LINE_STUDIO_CONFIG || {};
const TITLE = CFG.TITLE || 'Line Studio';
document.title = TITLE;
const $app = document.getElementById('app');

/* =====================================================================
   API (Supabase)
   ===================================================================== */
let sb = null;
const configured = !!(window.__MOCK_API__ || (CFG.SUPABASE_URL && CFG.SUPABASE_KEY));
async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(CFG.SUPABASE_URL.trim().replace(/\/+$/, ''), CFG.SUPABASE_KEY.trim(), { auth: { persistSession: false } });
  return sb;
}
const api = window.__MOCK_API__ || {
  async rpc(fn, args = {}) {
    const { data, error } = await (await client()).rpc(fn, args);
    if (error) throw new Error(cleanErr(error.message));
    return data;
  },
  async upload(path, blob) {
    const { error } = await (await client()).storage.from('takes').upload(path, blob, { contentType: 'audio/wav', upsert: false });
    if (error) throw new Error(error.message);
  },
  async remove(paths) {
    if (!paths || !paths.length) return;
    await (await client()).storage.from('takes').remove(paths);
  },
  url(path) {
    return `${CFG.SUPABASE_URL.trim().replace(/\/+$/, '')}/storage/v1/object/public/takes/${path}`;
  },
};
function cleanErr(m) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Keine Verbindung zum Server';
  if (/Could not find the function/i.test(m)) return 'Datenbank nicht eingerichtet (supabase.sql ausführen)';
  return m;
}

/* =====================================================================
   Helfer
   ===================================================================== */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function reveal(text, delay = 0) {
  let i = 0;
  return `<span class="reveal" style="--d:${delay}ms" aria-label="${esc(text)}">` +
    String(text).split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? p : `<span class="w" aria-hidden="true" style="--i:${i++}">${esc(p)}</span>`)).join('') +
    '</span>';
}
const GRADS = [['#ff375f', '#ff9f0a'], ['#5e5ce6', '#bf5af2'], ['#0a84ff', '#64d2ff'], ['#30d158', '#63e6be'], ['#ff9f0a', '#ffd60a'], ['#bf5af2', '#ff375f'], ['#64d2ff', '#5e5ce6']];
function avatar(name, cls = '') {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = GRADS[h % GRADS.length];
  return `<div class="avatar ${cls}" style="background:linear-gradient(135deg,${a},${b})">${esc(String(name).trim().charAt(0).toUpperCase() || '?')}</div>`;
}
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const fmtTime = (iso) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtSec = (x) => `${Number(x).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Sek.`;
function limitText(l) {
  const mn = l.min_sec, mx = l.max_sec;
  if (mn && mx) return `${Number(mn).toLocaleString('de-DE', { maximumFractionDigits: 1 })}–${fmtSec(mx)}`;
  if (mn) return `mind. ${fmtSec(mn)}`;
  if (mx) return `max. ${fmtSec(mx)}`;
  return '';
}
const parseSec = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null; };
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'line';
const isTouch = matchMedia('(hover: none)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Inhalt austauschen und die Höhe weich mitwachsen/-schrumpfen lassen (kein Springen)
function morph(el, update) {
  if (!el || reduceMotion) return update();
  const h0 = el.offsetHeight;
  update();
  const h1 = el.offsetHeight;
  if (Math.abs(h1 - h0) < 2) return;
  el.style.overflow = 'hidden';
  const a = el.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 480, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
  a.onfinish = a.oncancel = () => { el.style.overflow = ''; };
}
const levelToScale = (p) => { const db = p > 0 ? 20 * Math.log10(p) : -100; return Math.max(0, Math.min(1, (db + 60) / 60)); };

const I = {
  back: '<svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2 2 10l8 8"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1 1 6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.7v10.6c0 .8.9 1.3 1.6.9l8.6-5.3c.6-.4.6-1.4 0-1.8L5.6 1.8C4.9 1.4 4 1.9 4 2.7z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.6" height="12" rx="1.2"/><rect x="9.4" y="2" width="3.6" height="12" rx="1.2"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/></svg>',
  starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.8c0-.4.4-.8.8-.8h4.4c.4 0 .8.4.8.8V7M6 7l1 12.2c.1 1 .9 1.8 2 1.8h6c1.1 0 1.9-.8 2-1.8L18 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  dn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a2 2 0 0 1 2 2v.3a7 7 0 0 1 1.7 1l.3-.2a2 2 0 1 1 2 3.5l-.3.1a7 7 0 0 1 0 2l.3.2a2 2 0 1 1-2 3.4l-.3-.1a7 7 0 0 1-1.7 1v.3a2 2 0 1 1-4 0v-.3a7 7 0 0 1-1.7-1l-.3.1a2 2 0 1 1-2-3.4l.3-.2a7 7 0 0 1 0-2l-.3-.1a2 2 0 1 1 2-3.5l.3.2a7 7 0 0 1 1.7-1V5a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="2.6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v3h3M4 13a8 8 0 0 0 14.6 4.5M20 20v-3h-3"/></svg>',
};

/* ---------- Dynamic-Island-Toast ---------- */
let toastT;
function toast(msg, kind = 'info', ms = 2600) {
  const el = document.getElementById('island');
  const color = { info: '#0a84ff', ok: '#30d158', err: '#ff453a', warn: '#ff9f0a', rec: '#ff453a' }[kind];
  el.innerHTML = `<span class="dot" style="background:${color}"></span><span>${esc(msg)}</span>`;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- Sheet ---------- */
let openSheetEl = null;
function sheet(html, onMount) {
  closeSheet(true);
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  document.body.appendChild(wrap);
  openSheetEl = wrap;
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  onMount && onMount(wrap.querySelector('.sheet'));
  return wrap.querySelector('.sheet');
}
function closeSheet(instant) {
  const w = openSheetEl; if (!w) return;
  openSheetEl = null;
  if (instant) return w.remove();
  w.classList.add('closing'); w.querySelector('.sheet').classList.add('closing');
  setTimeout(() => w.remove(), 340);
}
function confirmSheet(title, text, okLabel = 'Löschen') {
  return new Promise((res) => {
    let done = false;
    const s = sheet(`<h2>${esc(title)}</h2><p class="center">${esc(text)}</p>
      <div style="display:grid;gap:10px"><button class="btn btn-danger btn-block" data-ok>${esc(okLabel)}</button>
      <button class="btn btn-secondary btn-block" data-close>Abbrechen</button></div>`);
    s.querySelector('[data-ok]').onclick = () => { done = true; closeSheet(); res(true); };
    const obs = new MutationObserver(() => { if (!document.body.contains(s)) { obs.disconnect(); if (!done) res(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- Audio-Player (einer für alles) ---------- */
const player = { audio: new Audio(), id: null, raf: 0 };
player.audio.preload = 'auto';
function playToggle(id, url, btn) {
  const a = player.audio;
  if (player.id === id && !a.paused) { a.pause(); return; }
  if (player.id !== id) { a.src = url; player.id = id; }
  a.play().catch(() => toast('Konnte nicht abspielen', 'err'));
}
function syncPlayButtons() {
  document.querySelectorAll('[data-play]').forEach((b) => {
    const on = b.dataset.play === player.id && !player.audio.paused;
    b.innerHTML = (on ? I.pause : I.play) + '<svg class="ring" viewBox="0 0 46 46"><circle cx="23" cy="23" r="21.5"/></svg>';
    b.setAttribute('aria-label', on ? 'Pause' : 'Abspielen');
  });
}
function ringLoop() {
  cancelAnimationFrame(player.raf);
  const a = player.audio;
  const step = () => {
    const b = document.querySelector(`[data-play="${player.id}"] circle`);
    if (b && a.duration) b.style.strokeDashoffset = 135 - 135 * (a.currentTime / a.duration);
    if (!a.paused) player.raf = requestAnimationFrame(step);
  };
  step();
}
['play', 'pause', 'ended'].forEach((ev) => player.audio.addEventListener(ev, () => {
  syncPlayButtons(); ringLoop();
  if (ev === 'ended') { const c = document.querySelector(`[data-play="${player.id}"] circle`); if (c) c.style.strokeDashoffset = 135; }
}));
function stopPlayback() { player.audio.pause(); }

/* =====================================================================
   Router
   ===================================================================== */
let cleanup = null;
function route() {
  closeSheet(true);
  stopPlayback();
  if (cleanup) { cleanup(); cleanup = null; }
  const h = location.hash.replace(/^#\/?/, '');
  window.scrollTo(0, 0);
  if (!configured) return renderNotConfigured();
  if (h === 'admin') return renderAdmin();
  const m = h.match(/^s\/([0-9a-f-]{36})$/i);
  if (m) return renderStudio(m[1]);
  renderHome();
}
window.addEventListener('hashchange', route);

function mount(html, cls = '') {
  $app.innerHTML = `<div class="view view-enter ${cls}">${html}</div>`;
  const nav = $app.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    const prev = cleanup; cleanup = () => { window.removeEventListener('scroll', onScroll); prev && prev(); };
  }
  return $app.firstElementChild;
}

/* =====================================================================
   Nicht konfiguriert
   ===================================================================== */
function renderNotConfigured() {
  mount(`
    <h1 class="large-title">${reveal('Fast fertig.')}</h1>
    <p class="subtitle fade-up" style="--d:300ms">Verbinde ${esc(TITLE)} noch mit deiner Supabase-Datenbank.</p>
    <div class="group setup-card stagger">
      <div class="step" style="--i:0"><span class="n">1</span><div>Erstelle ein kostenloses Projekt auf <a class="link" href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</div></div>
      <div class="step" style="--i:1"><span class="n">2</span><div>Öffne dort den <b>SQL Editor</b>, füge den Inhalt von <code>supabase.sql</code> ein und drücke <b>Run</b>.</div></div>
      <div class="step" style="--i:2"><span class="n">3</span><div>Trage Project-URL und anon/publishable Key in <code>config.js</code> ein.</div></div>
    </div>
    <p class="footnote fade-up" style="--d:600ms">Die genaue Anleitung steht in der README.</p>`);
}

/* =====================================================================
   Startseite: Namen
   ===================================================================== */
async function renderHome() {
  const v = mount(`
    <div style="height:calc(24px + env(safe-area-inset-top))"></div>
    <div class="eyebrow fade-up">${esc(TITLE)}</div>
    <h1 class="large-title">${reveal('Deine Stimme.')}<br><span class="gradient-text">Deine Lines.</span></h1>
    <p class="subtitle fade-up" style="--d:500ms">Tippe auf deinen Namen, um loszulegen.</p>
    <div id="list"><div class="group"><div class="uploading"><div class="spinner"></div><span class="meta">Lade…</span></div></div></div>
    <p class="footnote fade-up" style="--d:900ms;text-align:center;margin-top:40px"><a class="link" href="#/admin" style="color:var(--text-3)">Regie</a></p>`);
  let speakers;
  try { speakers = await api.rpc('list_speakers'); }
  catch (e) { v.querySelector('#list').innerHTML = `<div class="group"><div class="empty">${esc(e.message)}</div></div>`; return; }
  const list = v.querySelector('#list');
  if (!speakers.length) {
    list.innerHTML = `<div class="group fade-up"><div class="empty">Noch niemand eingetragen.<br>Lege in der <a class="link" href="#/admin">Regie</a> Sprecher an.</div></div>`;
    return;
  }
  list.innerHTML = `<div class="group stagger">${speakers.map((s, i) => `
    <button class="row" style="--i:${i}" data-sid="${s.id}" data-name="${esc(s.name)}">
      ${avatar(s.name)}<span class="grow title">${esc(s.name)}</span>${I.chev}
    </button>`).join('')}</div>`;
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sid]'); if (!b) return;
    const saved = store.get('ls_speaker');
    if (saved && saved.id === b.dataset.sid) { location.hash = `#/s/${b.dataset.sid}`; return; }
    passwordSheet(b.dataset.sid, b.dataset.name);
  });
}

function passwordSheet(sid, name) {
  const s = sheet(`
    ${avatar(name, 'big')}
    <h2>Hi ${esc(name)}</h2>
    <p class="center">Gib dein Passwort ein, um deine Lines zu sehen.</p>
    <form autocomplete="off">
      <input class="field" type="password" placeholder="Passwort" autocomplete="current-password" required>
      <button class="btn btn-primary btn-block" style="margin-top:14px">Weiter</button>
    </form>`);
  const inp = s.querySelector('input'); const form = s.querySelector('form');
  setTimeout(() => inp.focus(), 350);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true; btn.innerHTML = '<div class="spinner" style="border-top-color:#fff"></div>';
    try {
      await api.rpc('speaker_data', { sid, pw: inp.value });
      store.set('ls_speaker', { id: sid, pw: inp.value });
      closeSheet();
      location.hash = `#/s/${sid}`;
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Weiter';
      s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake');
      inp.select();
      toast(err.message, 'err');
    }
  };
}

/* =====================================================================
   Studio
   ===================================================================== */
const rec = new StudioRecorder();
const localBlobs = new Map(); // takeId -> blob URL (sofortiges Abspielen)

async function renderStudio(sid) {
  const creds = store.get('ls_speaker');
  if (!creds || creds.id !== sid) {
    location.hash = '';
    try { const all = await api.rpc('list_speakers'); const sp = all.find((x) => x.id === sid); if (sp) setTimeout(() => passwordSheet(sid, sp.name), 400); } catch {}
    return;
  }
  const v = mount(`<div class="nav always"><div class="nav-left"><a class="back" href="#">${I.back} Namen</a></div><div class="nav-title"></div><div class="nav-right"></div></div>
    <div style="padding:60px 0;display:grid;place-items:center"><div class="spinner"></div></div>`);
  let data;
  try { data = await api.rpc('speaker_data', { sid, pw: creds.pw }); }
  catch (e) { store.set('ls_speaker', null); toast(e.message, 'err'); location.hash = ''; return; }

  const st = {
    data, idx: 0, state: 'idle', // idle | counting | rec | busy
    countdown: store.get('ls_countdown') ?? true,
    deviceId: store.get('ls_mic') || '', levels: [], t0: 0, raf: 0, cdTimers: [], pending: null,
  };
  const firstOpen = st.data.lines.findIndex((l) => !l.takes.length);
  st.idx = firstOpen >= 0 ? firstOpen : 0;

  const view = mount(`
    <div class="nav"><div class="nav-left"><a class="back" href="#">${I.back} Namen</a></div>
      <div class="nav-title">${esc(data.name)}</div>
      <div class="nav-right"><button class="icon-btn" data-act="settings" aria-label="Mikrofon & Einstellungen">${I.mic}</button></div></div>
    <h1 class="large-title sm">${reveal('Hey ' + data.name + '.')}</h1>
    <p class="subtitle fade-up" style="--d:250ms;margin-bottom:22px" id="sub"></p>
    <div class="progress fade-up" style="--d:350ms"><div class="bar"><i id="bar"></i></div><span id="ptext"></span></div>
    <div id="card"></div>
    <div class="deck fade-up" style="--d:500ms">
      <button class="mic-chip" data-act="settings" id="micchip" aria-label="Mikrofon wählen und testen">${I.mic}<span class="led" id="led"></span><span class="lbl" id="miclbl">Mikrofon</span><span class="act">Wählen &amp; testen</span></button>
      <canvas class="wave" id="wave"></canvas>
      <div class="timer" id="timer">0:00.0</div>
      <div class="lenbar" id="lenbar"><div class="track"><i id="lenfill"></i><span class="mark" id="lenmin"></span></div><div class="lenlbl" id="lenlbl"></div></div>
      <div class="hint" id="hint"></div>
      <div class="rec-row">
        <button class="side-btn" data-act="prev" aria-label="Vorherige Line">${I.left}</button>
        <button class="rec" id="recbtn" data-act="rec" aria-label="Aufnahme starten"><i></i></button>
        <button class="side-btn" data-act="next" aria-label="Nächste Line">${I.right}</button>
      </div>
      <div class="meter"><i id="meter"></i></div>
    </div>
    <div class="section-h" id="takes-h">Deine Takes</div>
    <div class="group" id="takes"></div>
    <p class="footnote" id="takes-foot"></p>
    <div id="done"></div>`);

  const $ = (sel) => view.querySelector(sel);
  const canvas = $('#wave'); const g = canvas.getContext('2d');

  function line() { return st.data.lines[st.idx]; }
  function renderMeta() {
    const L = st.data.lines; const done = L.filter((l) => l.takes.length).length;
    $('#bar').style.width = L.length ? `${(done / L.length) * 100}%` : '0';
    $('#ptext').textContent = `${done} / ${L.length}`;
    $('#sub').textContent = !L.length ? 'Noch keine Lines für dich. Schau später nochmal rein.'
      : done === L.length ? 'Alles aufgenommen. Stark!' : `${L.length - done} ${L.length - done === 1 ? 'Line wartet' : 'Lines warten'} auf deine Stimme.`;
    $('#done').innerHTML = L.length && done === L.length ? `<div class="done-banner"><div class="check">${I.check}</div><div><b>Fertig!</b><div class="meta" style="color:var(--text-2);font-size:15px">Alle Lines sind gespeichert. Du kannst jederzeit weitere Takes aufnehmen.</div></div></div>` : '';
  }
  function renderCard(dir = 0, animate = true) {
    const L = st.data.lines; const l = line();
    if (!l) { $('#card').innerHTML = `<div class="line-card"><p class="line-text" style="color:var(--text-2)">Keine Lines.</p></div>`; return; }
    morph($('#card'), () => { $('#card').innerHTML = `<div class="line-card ${!animate ? '' : dir > 0 ? 'slide-l' : dir < 0 ? 'slide-r' : 'fade-up'}" style="--d:400ms">
      <div class="top"><span class="eyebrow">Line ${st.idx + 1} von ${L.length}</span>
        ${l.takes.length ? `<span class="badge done">${I.check} ${l.takes.length} ${l.takes.length === 1 ? 'Take' : 'Takes'}</span>` : '<span class="badge">Offen</span>'}</div>
      <p class="line-text">${animate ? reveal(l.text, dir ? 80 : 500) : esc(l.text)}</p>
      ${l.note ? `<div class="line-note">${I.bulb}<span>${esc(l.note)}</span></div>` : ''}
      ${limitText(l) ? `<div class="line-limit">${I.clock}<span>Länge: <b>${limitText(l)}</b></span></div>` : ''}
      <div class="pager"><span></span><div class="dots">${L.map((x, i) => `<button data-go="${i}" class="${i === st.idx ? 'cur' : ''} ${x.takes.length ? 'has' : ''}" aria-label="Line ${i + 1}"></button>`).join('')}</div><span></span></div>
    </div>`; });
    view.querySelector('[data-act="prev"]').disabled = st.idx === 0 || st.state !== 'idle';
    view.querySelector('[data-act="next"]').disabled = st.idx >= L.length - 1 || st.state !== 'idle';
  }
  function renderTakes(newId) {
    const l = line(); const box = $('#takes');
    $('#takes-h').style.display = l ? '' : 'none'; box.style.display = l ? '' : 'none';
    if (!l) return;
    let html = l.takes.map((t, i) => `
      <div class="take ${t.id === newId ? 'new' : ''}" data-tid="${t.id}">
        <button class="play" data-play="${t.id}" data-url="${esc(localBlobs.get(t.id) || api.url(t.path))}" aria-label="Abspielen"></button>
        <div class="grow"><div class="t1">Take ${i + 1} ${t.is_best ? '<span class="pill-best">FAVORIT</span>' : ''}</div>
          <div class="t2">${fmt(t.duration)} · ${fmtTime(t.created_at)}</div></div>
        <button class="mini star ${t.is_best ? 'on' : ''}" data-best="${t.id}" aria-label="Als Favorit markieren">${t.is_best ? I.star : I.starO}</button>
        <button class="mini del" data-del="${t.id}" aria-label="Take löschen">${I.trash}</button>
      </div>`).join('');
    if (st.pending) html += `<div class="uploading take new">${st.pending.error
      ? `<div class="grow"><div class="t1" style="color:var(--red)">Upload fehlgeschlagen</div><div class="t2">${esc(st.pending.error)}</div></div>
         <button class="btn btn-sm btn-secondary" data-act="retry">Nochmal</button><button class="mini" data-act="save-local" aria-label="Lokal speichern">${I.down}</button>`
      : `<div class="spinner"></div><div class="grow"><div class="t1">Wird gespeichert…</div><div class="t2">${fmt(st.pending.duration)} · WAV ${Math.round(st.pending.sampleRate / 1000)} kHz / 24 Bit</div></div>`}</div>`;
    if (!l.takes.length && !st.pending) html = `<div class="empty">Noch kein Take. Drück auf den roten Knopf.</div>`;
    morph(box, () => { box.innerHTML = html; });
    syncPlayButtons();
    $('#takes-foot').textContent = l.takes.length > 1 ? 'Markiere mit dem Stern deinen besten Take.' : '';
  }
  function renderLen() {
    const l = line(); const box = $('#lenbar');
    const mn = l?.min_sec, mx = l?.max_sec;
    box.classList.toggle('show', !!(mn || mx));
    if (!(mn || mx)) return;
    st.lenScale = mx || mn * 1.6;
    const m = $('#lenmin'); m.style.display = mn ? '' : 'none'; if (mn) m.style.left = `${(mn / st.lenScale) * 100}%`;
    $('#lenlbl').textContent = mn && mx ? `mindestens ${fmtSec(mn)} · höchstens ${fmtSec(mx)}` : mn ? `mindestens ${fmtSec(mn)}` : `höchstens ${fmtSec(mx)} (stoppt automatisch)`;
    if (st.state !== 'rec') { $('#lenfill').style.transform = 'scaleX(0)'; $('#lenbar').className = 'lenbar show'; }
  }
  function renderMic() {
    $('#led').classList.toggle('on', rec.active);
    $('#miclbl').textContent = rec.active ? shortLabel(st.micLabel) : 'Mikrofon';
  }
  function shortLabel(s) { s = String(s || 'Mikrofon').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, ''); return s.length > 32 ? s.slice(0, 31) + '…' : s; }
  function renderHint() {
    renderMic(); renderLen();
    const h = $('#hint'); const b = $('#recbtn');
    b.classList.toggle('on', st.state === 'rec'); b.classList.toggle('counting', st.state === 'counting');
    b.disabled = st.state === 'busy' || !line();
    b.setAttribute('aria-label', st.state === 'rec' ? 'Aufnahme stoppen' : 'Aufnahme starten');
    $('#timer').classList.toggle('live', st.state === 'rec');
    const key = isTouch ? '' : ' <span class="kbd">Leertaste</span>';
    h.innerHTML = st.state === 'rec' ? `Aufnahme läuft. Zum Stoppen tippen${key}`
      : st.state === 'counting' ? 'Gleich geht’s los…'
      : st.state === 'busy' ? 'Speichere…'
      : rec.active ? `Bereit${st.countdown ? ' · mit 3-2-1' : ''}.${key}`
      : `Tippe zum Aufnehmen. Beim ersten Mal fragt dein Browser nach dem Mikrofon.`;
    view.querySelector('[data-act="prev"]').disabled = st.idx === 0 || st.state !== 'idle';
    view.querySelector('[data-act="next"]').disabled = st.idx >= st.data.lines.length - 1 || st.state !== 'idle';
  }
  function go(i) {
    if (st.state !== 'idle' || i < 0 || i >= st.data.lines.length || i === st.idx) return;
    const dir = i > st.idx ? 1 : -1; st.idx = i; stopPlayback();
    renderCard(dir); renderTakes(); renderHint();
  }

  /* ---- Waveform (Voice-Memos-Stil) ---- */
  function sizeCanvas() { const r = canvas.getBoundingClientRect(); const d = devicePixelRatio || 1; canvas.width = r.width * d; canvas.height = r.height * d; }
  sizeCanvas();
  const onResize = () => sizeCanvas(); window.addEventListener('resize', onResize);
  st.peak = 0; st.shown = 0;
  rec.onLevel = (p) => {
    st.levels.push({ p, r: st.state === 'rec' });
    if (st.levels.length > 400) st.levels.shift();
    st.peak = Math.max(st.peak, p);
  };
  function draw() {
    const W = canvas.width, H = canvas.height, d = devicePixelRatio || 1;
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    const red = cs.getPropertyValue('--red').trim(), grey = cs.getPropertyValue('--text-3').trim();
    const bw = 3 * d, gap = 2 * d, step = bw + gap, n = Math.floor(W / step);
    const lv = st.levels.slice(-n);
    g.globalAlpha = .25; g.fillStyle = grey; g.fillRect(0, H / 2 - .5 * d, W, d); g.globalAlpha = 1;
    for (let i = 0; i < lv.length; i++) {
      const x = W - (lv.length - i) * step;
      const amp = Math.min(1, Math.pow(lv[i].p, 0.6) * 1.15);
      const h = Math.max(2 * d, amp * (H - 8 * d));
      g.fillStyle = lv[i].r ? red : grey;
      g.globalAlpha = lv[i].r ? 1 : .55;
      roundRect(g, x, (H - h) / 2, bw, h, bw / 2);
    }
    g.globalAlpha = 1;
    if (st.state === 'rec') {
      const el = (performance.now() - st.t0) / 1000; const l = line();
      $('#timer').textContent = fmt(el);
      if (l && (l.min_sec || l.max_sec)) {
        $('#lenfill').style.transform = `scaleX(${Math.min(1, el / st.lenScale).toFixed(4)})`;
        const lb = $('#lenbar');
        lb.classList.toggle('ok', !l.min_sec || el >= l.min_sec);
        lb.classList.toggle('near', !!l.max_sec && el >= l.max_sec - 1.5);
        if (l.max_sec && el >= l.max_sec) { toast(`Maximallänge erreicht (${fmtSec(l.max_sec)})`, 'info', 2200); stopRec(); }
      }
    }
    const target = levelToScale(st.peak); st.peak = 0;
    st.shown = target > st.shown ? target : st.shown * 0.9 + target * 0.1; // schnell hoch, sanft runter
    const cp = `inset(0 ${(100 - st.shown * 100).toFixed(1)}% 0 0 round 5px)`;
    $('#meter').style.clipPath = cp;
    const bm = document.getElementById('bigmeter'); if (bm) bm.style.clipPath = cp;
    st.raf = requestAnimationFrame(draw);
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.fill(); }
  st.raf = requestAnimationFrame(draw);

  /* ---- Aufnahme ---- */
  async function ensureMic() {
    if (rec.active) { if (rec.ctx.state === 'suspended') await rec.ctx.resume(); return true; }
    try {
      st.micLabel = await rec.start(st.deviceId);
      renderMic();
      return true;
    } catch (e) {
      if (st.deviceId) { st.deviceId = ''; store.set('ls_mic', null); return ensureMic(); }
      toast(e.name === 'NotAllowedError' ? 'Mikrofon wurde blockiert. Erlaube es in den Browser-Einstellungen.' : 'Kein Mikrofon gefunden', 'err', 4500);
      return false;
    }
  }
  async function onRec() {
    if (st.state === 'rec') return stopRec();
    if (st.state === 'counting') return cancelCountdown();
    if (st.state !== 'idle' || !line()) return;
    stopPlayback();
    if (!(await ensureMic())) return renderHint();
    if (st.countdown) {
      st.state = 'counting'; renderHint();
      const ov = document.createElement('div'); ov.className = 'countdown'; document.body.appendChild(ov); st.ov = ov;
      [3, 2, 1].forEach((n, i) => st.cdTimers.push(setTimeout(() => { ov.innerHTML = `<span>${n}</span>`; }, i * 1000)));
      st.cdTimers.push(setTimeout(() => { beginRec(); ov.classList.add('out'); ov.innerHTML = ''; setTimeout(() => ov.remove(), 300); }, 3000));
    } else beginRec();
  }
  function cancelCountdown() {
    st.cdTimers.forEach(clearTimeout); st.cdTimers = [];
    st.ov && st.ov.remove(); st.state = 'idle'; renderHint();
  }
  function beginRec() {
    st.cdTimers = []; rec.begin(); st.t0 = performance.now() - rec.preSec * 1000; st.state = 'rec'; renderHint();
    navigator.vibrate && navigator.vibrate(30);
  }
  async function stopRec() {
    if (st.state !== 'rec') return;
    const r = rec.end(); st.state = 'idle';
    $('#timer').textContent = fmt(r.duration);
    if (r.duration < 0.6) { renderHint(); return toast('Zu kurz, nochmal versuchen', 'warn'); }
    const lm = line();
    if (lm.min_sec && r.duration < lm.min_sec - 0.05) { renderHint(); return toast(`Zu kurz: mindestens ${fmtSec(lm.min_sec)} Nochmal!`, 'warn', 3500); }
    if (lm.max_sec && r.duration > lm.max_sec) { r.blob = await trimWav(r.blob, lm.max_sec, r.sampleRate); r.duration = lm.max_sec; }
    if (r.clipped) toast('Etwas zu laut, geh ein Stück weiter weg vom Mikro', 'warn', 4000);
    st.pending = { ...r, lineId: line().id };
    await upload();
  }
  async function upload() {
    const p = st.pending; if (!p) return;
    p.error = null; st.state = 'busy'; renderTakes(); renderHint();
    try {
      if (!p.take) p.take = await api.rpc('start_take', { sid, pw: creds.pw, lid: p.lineId });
      if (!p.uploaded) { await api.upload(p.take.path, p.blob); p.uploaded = true; }
      st.data = await api.rpc('finish_take', { sid, pw: creds.pw, tid: p.take.id, dur: p.duration });
      localBlobs.set(p.take.id, URL.createObjectURL(p.blob));
      st.pending = null; st.state = 'idle';
      const i = st.data.lines.findIndex((l) => l.id === p.lineId); if (i >= 0) st.idx = i;
      renderMeta(); renderCard(0, false); renderTakes(p.take.id); renderHint();
      toast('Gespeichert', 'ok', 1600);
    } catch (e) {
      p.error = e.message; st.state = 'idle'; renderTakes(); renderHint();
      toast('Upload fehlgeschlagen', 'err');
    }
  }
  function saveLocal() {
    const p = st.pending; if (!p) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(p.blob);
    a.download = `${slug(st.data.name)}_${String(st.idx + 1).padStart(2, '0')}_${slug(line().text)}.wav`; a.click();
  }

  async function refresh() { st.data = await api.rpc('speaker_data', { sid, pw: creds.pw }); renderMeta(); renderCard(0, false); renderTakes(); renderHint(); }

  function settings(first) {
    const s = sheet(`
      <h2>${first ? 'Kurzer Mikro-Check' : 'Mikrofon'}</h2>
      <p class="center">${first ? 'Wähl dein Mikro und mach eine Testaufnahme, bevor du loslegst.' : 'Wähl dein Mikro und teste, wie du klingst.'}</p>
      <div class="group dev-list" id="devs" style="box-shadow:none;background:var(--card-2)"><div class="uploading"><div class="spinner"></div><span class="meta">Mikrofone werden gesucht…</span></div></div>
      <div class="section-h" style="margin:20px 4px 6px">Pegel</div>
      <div class="big-meter"><i id="bigmeter"></i></div>
      <div class="meter-legend"><span>leise</span><span>gut</span><span>zu laut</span></div>
      <button class="btn btn-secondary btn-block test-btn" style="margin-top:14px" id="testbtn"><span class="fill"></span><span id="testlbl">Test aufnehmen (3 Sek.)</span></button>
      <div class="mic-status" id="micstatus">Sag etwas: Der Balken sollte beim Sprechen bis ins Gelbe gehen.</div>
      <div class="group" style="box-shadow:none;background:var(--card-2);margin-top:18px">
        <label class="row plain" style="cursor:pointer"><span class="grow">3-2-1 Countdown</span>
          <span class="switch"><input type="checkbox" id="cd" ${st.countdown ? 'checked' : ''}><span class="track"></span><span class="knob"></span></span></label>
      </div>
      <div class="section-h" style="margin-left:4px">Profi-Tipps</div>
      <div class="group" style="box-shadow:none;background:var(--card-2)">
        <div class="row plain"><span class="grow meta" style="color:var(--text)">🎧 Kopfhörer auf, damit der Discord-Call nicht mit aufgenommen wird.</span></div>
        <div class="row plain"><span class="grow meta" style="color:var(--text)">🤫 Ruhiger Raum. Weiche Möbel, Decken und Vorhänge schlucken Hall.</span></div>
        <div class="row plain"><span class="grow meta" style="color:var(--text)">📏 Etwa eine Handbreit Abstand zum Mikro.</span></div>
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:20px" data-close>${first ? 'Los geht’s' : 'Fertig'}</button>
      ${first ? '' : '<button class="btn btn-block" style="margin-top:6px;color:var(--red)" id="logout">Abmelden</button>'}`);
    store.set('ls_miccheck', 1);
    const devs = s.querySelector('#devs'); const status = s.querySelector('#micstatus');
    const testBtn = s.querySelector('#testbtn'); const testLbl = s.querySelector('#testlbl');
    let testing = false, testUrl = null, testTimer = 0, peakSeen = 0;
    const fill = async () => {
      let ds = [];
      try { ds = (await StudioRecorder.devices()).filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'); } catch {}
      const track = rec.stream?.getAudioTracks()[0];
      let cur = st.deviceId || track?.getSettings().deviceId || '';
      if (!ds.some((d) => d.deviceId === cur)) cur = (ds.find((d) => track && d.label === track.label) || ds[0] || {}).deviceId;
      if (!ds.length) { devs.innerHTML = `<div class="empty">${rec.active ? esc(shortLabel(st.micLabel)) : 'Kein Mikrofon gefunden. Erlaube den Zugriff im Browser.'}</div>`; return; }
      morph(devs, () => {
        devs.innerHTML = ds.map((d, i) => `<button class="row plain ${d.deviceId === cur ? 'sel' : ''}" data-dev="${esc(d.deviceId)}">
          <span class="grow title">${esc(shortLabel(d.label || 'Mikrofon ' + (i + 1)))}</span>
          <svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>`).join('');
      });
    };
    ensureMic().then(fill).then(renderHint);
    devs.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dev]'); if (!b || testing) return;
      devs.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r === b));
      st.deviceId = b.dataset.dev; store.set('ls_mic', st.deviceId);
      await rec.stop(); await ensureMic(); renderHint();
      status.className = 'mic-status'; status.textContent = `${shortLabel(st.micLabel)} ist aktiv. Mach eine Testaufnahme.`;
    });
    const prevLevel = rec.onLevel;
    rec.onLevel = (p) => { prevLevel && prevLevel(p); if (testing) peakSeen = Math.max(peakSeen, p); };
    testBtn.onclick = async () => {
      if (testing) return;
      if (testUrl && testLbl.dataset.mode === 'play') { playToggle('miktest', testUrl); return; }
      if (!(await ensureMic())) return;
      stopPlayback(); testing = true; peakSeen = 0;
      testBtn.classList.add('rec'); testLbl.textContent = 'Nimmt auf… sprich jetzt!';
      status.className = 'mic-status'; status.textContent = 'Sag zum Beispiel: „Erster Tag am MIT!“';
      rec.begin();
      testTimer = setTimeout(() => {
        const r = rec.end(); testing = false; testBtn.classList.remove('rec');
        if (testUrl) URL.revokeObjectURL(testUrl);
        testUrl = URL.createObjectURL(r.blob);
        testLbl.dataset.mode = 'play'; testLbl.textContent = '▶︎ Test anhören';
        const ok = levelToScale(peakSeen);
        if (r.clipped || ok > 0.97) { status.className = 'mic-status bad'; status.textContent = 'Zu laut: Geh etwas weiter weg vom Mikro.'; }
        else if (ok < 0.45) { status.className = 'mic-status bad'; status.textContent = 'Ziemlich leise: Geh näher ran oder wähl ein anderes Mikro.'; }
        else { status.className = 'mic-status good'; status.textContent = 'Klingt gut! Pegel passt.'; }
        playToggle('miktest', testUrl);
        setTimeout(() => { if (document.body.contains(testBtn)) { testLbl.dataset.mode = 'play'; } }, 0);
        const again = document.createElement('button'); again.className = 'btn btn-block'; again.style.cssText = 'margin-top:4px;color:var(--blue);height:40px;font-size:15px'; again.textContent = 'Neuer Test';
        again.onclick = () => { again.remove(); testLbl.dataset.mode = ''; stopPlayback(); testBtn.click(); };
        if (!s.querySelector('#again')) { again.id = 'again'; testBtn.after(again); }
      }, 3000);
    };
    s.querySelector('#cd').onchange = (e) => { st.countdown = e.target.checked; store.set('ls_countdown', st.countdown); renderHint(); };
    const lo = s.querySelector('#logout'); if (lo) lo.onclick = () => { store.set('ls_speaker', null); closeSheet(); location.hash = ''; };
    const obs = new MutationObserver(() => {
      if (!document.body.contains(s)) {
        obs.disconnect(); clearTimeout(testTimer);
        if (testing) { rec.end(); testing = false; }
        if (player.id === 'miktest') stopPlayback();
        rec.onLevel = prevLevel;
      }
    });
    obs.observe(document.body, { childList: true });
  }

  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'rec') return onRec();
    if (act === 'prev') return go(st.idx - 1);
    if (act === 'next') return go(st.idx + 1);
    if (act === 'settings') return st.state === 'idle' ? settings() : null;
    if (act === 'retry') return upload();
    if (act === 'save-local') return saveLocal();
    if (t.dataset.go) return go(+t.dataset.go);
    if (t.dataset.play) return playToggle(t.dataset.play, t.dataset.url, t);
    if (t.dataset.best) {
      try { st.data = await api.rpc('set_best', { sid, pw: creds.pw, tid: t.dataset.best }); renderTakes(); toast('Als Favorit markiert', 'ok', 1500); }
      catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (t.dataset.del) {
      if (!(await confirmSheet('Take löschen?', 'Diese Aufnahme wird endgültig gelöscht.'))) return;
      const row = t.closest('.take'); row.classList.add('removing');
      try {
        if (player.id === t.dataset.del) stopPlayback();
        const path = await api.rpc('delete_take', { sid, pw: creds.pw, tid: t.dataset.del });
        api.remove([path]).catch(() => {});
        await refresh();
      } catch (err) { row.classList.remove('removing'); toast(err.message, 'err'); }
    }
  });
  const onKey = (e) => {
    if (openSheetEl || e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) onRec(); }
    else if (e.key === 'ArrowRight') go(st.idx + 1);
    else if (e.key === 'ArrowLeft') go(st.idx - 1);
    else if (e.key === 'Escape' && st.state === 'counting') cancelCountdown();
  };
  document.addEventListener('keydown', onKey);
  const onUnload = (e) => { if (st.state === 'rec' || st.pending) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);

  const prev = cleanup;
  cleanup = () => {
    prev && prev();
    cancelAnimationFrame(st.raf); st.cdTimers.forEach(clearTimeout); st.ov && st.ov.remove();
    window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload);
    rec.onLevel = null; rec.stop();
  };

  renderMeta(); renderCard(); renderTakes(); renderHint();
  if (!store.get('ls_miccheck') && st.data.lines.length) setTimeout(() => { if (!openSheetEl && st.state === 'idle') settings(true); }, 1400);
}

/* =====================================================================
   Admin / Regie
   ===================================================================== */
async function renderAdmin() {
  const pw = (() => { try { return sessionStorage.getItem('ls_admin'); } catch { return null; } })();
  if (pw) {
    try { const d = await api.rpc('admin_data', { pw }); return adminDashboard(pw, d); }
    catch { try { sessionStorage.removeItem('ls_admin'); } catch {} }
  }
  let isSetup = true;
  try { isSetup = await api.rpc('admin_is_setup'); } catch (e) { mount(`<h1 class="large-title">Regie</h1><div class="group"><div class="empty">${esc(e.message)}</div></div>`); return; }
  const v = mount(`
    <div class="nav always"><div class="nav-left"><a class="back" href="#">${I.back} ${esc(TITLE)}</a></div><div class="nav-title"></div><div class="nav-right"></div></div>
    <h1 class="large-title">${reveal('Regie.')}</h1>
    <p class="subtitle fade-up" style="--d:250ms">${isSetup ? 'Melde dich an, um Lines zu schreiben und Aufnahmen abzuholen.' : 'Willkommen! Lege zuerst dein Admin-Passwort fest. Das geht nur dieses eine Mal.'}</p>
    <form class="fade-up" style="--d:400ms;max-width:420px" id="f">
      <input class="field" type="password" placeholder="${isSetup ? 'Admin-Passwort' : 'Neues Admin-Passwort (min. 4 Zeichen)'}" autocomplete="${isSetup ? 'current-password' : 'new-password'}" required>
      ${isSetup ? '' : '<input class="field" type="password" placeholder="Passwort wiederholen" autocomplete="new-password" required style="margin-top:10px">'}
      <button class="btn btn-primary btn-block" style="margin-top:14px">${isSetup ? 'Anmelden' : 'Passwort festlegen'}</button>
    </form>`);
  const f = v.querySelector('#f'); const ins = f.querySelectorAll('input');
  setTimeout(() => ins[0].focus(), 400);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const p = ins[0].value;
    try {
      if (!isSetup) {
        if (p !== ins[1].value) throw new Error('Passwörter stimmen nicht überein');
        await api.rpc('admin_setup', { new_pw: p });
      }
      const d = await api.rpc('admin_data', { pw: p });
      try { sessionStorage.setItem('ls_admin', p); } catch {}
      adminDashboard(p, d);
    } catch (err) {
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      toast(err.message, 'err');
    }
  };
}

function adminDashboard(pw, data) {
  let speakers = data;
  const v = mount(`
    <div class="nav"><div class="nav-left"><a class="back" href="#">${I.back} ${esc(TITLE)}</a></div><div class="nav-title">Regie</div>
      <div class="nav-right"><button class="icon-btn" data-act="refresh" aria-label="Aktualisieren">${I.refresh}</button></div></div>
    <h1 class="large-title sm">${reveal('Regie.')}</h1>
    <p class="subtitle fade-up" style="--d:200ms;margin-bottom:20px" id="sum"></p>
    <div class="toolbar fade-up" style="--d:300ms">
      <button class="btn btn-primary btn-sm" data-act="add-speaker">${I.plus.replace('<svg', '<svg width="16" height="16"')} Sprecher</button>
      <button class="btn btn-secondary btn-sm" data-act="zip-best">${I.down.replace('<svg', '<svg width="16" height="16"')} Favoriten (ZIP)</button>
      <button class="btn btn-secondary btn-sm" data-act="zip-all">Alle Takes (ZIP)</button>
      <button class="btn btn-sm" style="color:var(--text-2)" data-act="logout">Abmelden</button>
    </div>
    <div id="spk"></div>`, 'wide');
  const box = v.querySelector('#spk');

  let firstRender = true;
  function render() {
    const nl = speakers.reduce((s, x) => s + x.lines.length, 0);
    const nd = speakers.reduce((s, x) => s + x.lines.filter((l) => l.takes.length).length, 0);
    const nt = speakers.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.takes.length, 0), 0);
    v.querySelector('#sum').textContent = speakers.length ? `${speakers.length} Sprecher · ${nd} von ${nl} Lines aufgenommen · ${nt} Takes` : 'Leg los: Füge deinen ersten Sprecher hinzu.';
    box.innerHTML = speakers.map((s, si) => {
      const done = s.lines.filter((l) => l.takes.length).length;
      return `<section class="spk ${firstRender ? 'fade-up' : ''}" style="--d:${350 + si * 80}ms" data-spk="${s.id}">
        <div class="spk-head">${avatar(s.name)}<h3>${esc(s.name)}</h3><span class="meta">${done}/${s.lines.length}</span>
          <button class="mini" data-act="copy-link" aria-label="Link kopieren" title="Link für ${esc(s.name)} kopieren">${I.link}</button>
          <button class="mini" data-act="edit-speaker" aria-label="Bearbeiten" title="Name / Passwort ändern">${I.edit}</button>
          <button class="mini del" data-act="del-speaker" aria-label="Sprecher löschen">${I.trash}</button></div>
        <div class="group">
          ${s.lines.map((l, i) => `
            <div class="aline" data-lid="${l.id}">
              <div class="aline-top">
                <span class="aline-num ${l.takes.length ? 'has' : ''}">${i + 1}</span>
                <div class="aline-body">
                  <textarea class="inline-input text" rows="1" data-field="text" aria-label="Line-Text">${esc(l.text)}</textarea>
                  <textarea class="inline-input note" rows="1" data-field="note" placeholder="+ Regieanweisung (z. B. aufgeregt, Spider-Man-mäßig)" aria-label="Regieanweisung">${esc(l.note)}</textarea>
                  <div class="limits">${I.clock}<span>Länge</span>
                    <label>min <input inputmode="decimal" data-lim="min" placeholder="–" value="${l.min_sec ?? ''}" aria-label="Mindestlänge in Sekunden"></label>
                    <label>max <input inputmode="decimal" data-lim="max" placeholder="–" value="${l.max_sec ?? ''}" aria-label="Maximallänge in Sekunden"></label>
                    <span>Sek.</span></div>
                </div>
                <div class="aline-tools">
                  <button class="mini" data-act="up" aria-label="Nach oben" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>${I.up}</button>
                  <button class="mini" data-act="down" aria-label="Nach unten" ${i === s.lines.length - 1 ? 'disabled style="opacity:.25"' : ''}>${I.dn}</button>
                  <button class="mini del" data-act="del-line" aria-label="Line löschen">${I.trash}</button>
                </div>
              </div>
              ${l.takes.length ? `<div class="atakes">${l.takes.map((t, ti) => `
                <div class="atake" data-tid="${t.id}">
                  <button class="play" data-play="${t.id}" data-url="${esc(api.url(t.path))}"></button>
                  <span class="grow">Take ${ti + 1} · ${fmt(t.duration)} · ${fmtTime(t.created_at)} ${t.is_best ? '<span class="pill-best">FAVORIT</span>' : ''}</span>
                  <button class="mini star ${t.is_best ? 'on' : ''}" data-act="best" aria-label="Favorit">${t.is_best ? I.star : I.starO}</button>
                  <button class="mini" data-act="dl" aria-label="Herunterladen">${I.down}</button>
                  <button class="mini del" data-act="del-take" aria-label="Take löschen">${I.trash}</button>
                </div>`).join('')}</div>` : ''}
            </div>`).join('')}
          <div class="add-lines">
            <textarea class="field" placeholder="Neue Lines für ${esc(s.name)} eintippen. Eine Line pro Zeile." data-add></textarea>
            <button class="btn btn-primary btn-sm" data-act="add-lines">Hinzufügen</button>
          </div>
        </div>
      </section>`;
    }).join('');
    box.querySelectorAll('textarea.inline-input').forEach(autosize);
    syncPlayButtons();
    firstRender = false;
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

  async function reload(quiet) {
    try { const d = await api.rpc('admin_data', { pw }); if (JSON.stringify(d) !== JSON.stringify(speakers)) { speakers = d; morph(box, render); } }
    catch (e) { if (!quiet) toast(e.message, 'err'); }
  }
  const find = (sid) => speakers.find((s) => s.id === sid);
  const takeOf = (tid) => { for (const s of speakers) for (const [li, l] of s.lines.entries()) for (const [ti, t] of l.takes.entries()) if (t.id === tid) return { s, l, li, t, ti }; };
  const fileName = (s, li, l, ti, t) => `${slug(s.name)}_${String(li + 1).padStart(2, '0')}_${slug(l.text)}_take${ti + 1}${t.is_best ? '_FAVORIT' : ''}.wav`;

  async function zip(bestOnly) {
    const files = [];
    for (const s of speakers) s.lines.forEach((l, li) => l.takes.forEach((t, ti) => { if (!bestOnly || t.is_best) files.push({ s, l, li, t, ti }); }));
    if (!files.length) return toast('Noch keine Aufnahmen', 'warn');
    toast(`Packe ${files.length} Dateien…`, 'info', 60000);
    try {
      if (!window.JSZip) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
      const z = new window.JSZip();
      let n = 0;
      await Promise.all(files.map(async (f) => {
        const b = await (await fetch(api.url(f.t.path))).blob();
        z.folder(f.s.name.replace(/[\\/:*?"<>|]/g, '_')).file(bestOnly ? `${slug(f.s.name)}_${String(f.li + 1).padStart(2, '0')}_${slug(f.l.text)}.wav` : fileName(f.s, f.li, f.l, f.ti, f.t), b);
        toast(`Lade ${++n} / ${files.length}…`, 'info', 60000);
      }));
      const out = await z.generateAsync({ type: 'blob', compression: 'STORE' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(out); a.download = `${slug(TITLE)}_${bestOnly ? 'favoriten' : 'alle-takes'}.zip`; a.click();
      toast('ZIP fertig', 'ok');
    } catch { toast('ZIP fehlgeschlagen', 'err'); }
  }

  function speakerSheet(s) {
    const sh = sheet(`
      ${s ? avatar(s.name, 'big') : ''}
      <h2>${s ? 'Sprecher bearbeiten' : 'Neuer Sprecher'}</h2>
      <p class="center">${s ? 'Passwort leer lassen, um es nicht zu ändern.' : 'Das Passwort gibst du deinem Freund.'}</p>
      <form><input class="field" name="n" placeholder="Name" value="${esc(s ? s.name : '')}" required>
        <input class="field" name="p" placeholder="${s ? 'Neues Passwort (optional)' : 'Passwort'}" style="margin-top:10px" ${s ? '' : 'required'} autocomplete="off">
        <button class="btn btn-primary btn-block" style="margin-top:14px">${s ? 'Speichern' : 'Anlegen'}</button></form>`);
    const f = sh.querySelector('form'); setTimeout(() => f.n.focus(), 350);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.rpc('admin_save_speaker', { pw, sid: s ? s.id : null, new_name: f.n.value, new_pw: f.p.value || null });
        closeSheet(); toast(s ? 'Gespeichert' : `${f.n.value.trim()} angelegt`, 'ok'); reload();
      } catch (err) { sh.classList.remove('shake'); void sh.offsetWidth; sh.classList.add('shake'); toast(err.message, 'err'); }
    };
  }

  v.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act; const spk = b.closest('[data-spk]'); const s = spk && find(spk.dataset.spk);
    const lid = b.closest('[data-lid]')?.dataset.lid; const tid = b.closest('[data-tid]')?.dataset.tid;
    try {
      if (b.dataset.play) return playToggle(b.dataset.play, b.dataset.url, b);
      if (act === 'refresh') { await reload(); return toast('Aktuell', 'ok', 1200); }
      if (act === 'logout') { try { sessionStorage.removeItem('ls_admin'); } catch {} return route(); }
      if (act === 'add-speaker') return speakerSheet(null);
      if (act === 'edit-speaker') return speakerSheet(s);
      if (act === 'zip-best') return zip(true);
      if (act === 'zip-all') return zip(false);
      if (act === 'copy-link') {
        const url = `${location.origin}${location.pathname}#/s/${s.id}`;
        try { await navigator.clipboard.writeText(url); toast(`Link für ${s.name} kopiert`, 'ok'); }
        catch { prompt('Link kopieren:', url); }
        return;
      }
      if (act === 'del-speaker') {
        if (!(await confirmSheet(`${s.name} löschen?`, 'Alle Lines und Aufnahmen dieses Sprechers werden endgültig gelöscht.'))) return;
        const paths = await api.rpc('admin_delete_speaker', { pw, sid: s.id }); await api.remove(paths).catch(() => {});
        toast('Gelöscht', 'ok'); return reload();
      }
      if (act === 'add-lines') {
        const ta = spk.querySelector('[data-add]'); const texts = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (!texts.length) return ta.focus();
        await api.rpc('admin_add_lines', { pw, sid: s.id, texts }); ta.value = '';
        toast(`${texts.length} ${texts.length === 1 ? 'Line' : 'Lines'} hinzugefügt`, 'ok'); return reload();
      }
      if (act === 'up' || act === 'down') { await api.rpc('admin_move_line', { pw, lid, dir: act === 'up' ? -1 : 1 }); return reload(); }
      if (act === 'del-line') {
        const l = s.lines.find((x) => x.id === lid);
        if (!(await confirmSheet('Line löschen?', l.takes.length ? `Auch die ${l.takes.length} Aufnahme(n) dazu werden gelöscht.` : 'Die Line wird entfernt.'))) return;
        const paths = await api.rpc('admin_delete_line', { pw, lid }); await api.remove(paths).catch(() => {});
        return reload();
      }
      if (act === 'best') { await api.rpc('admin_set_best', { pw, tid }); return reload(); }
      if (act === 'del-take') {
        if (!(await confirmSheet('Take löschen?', 'Diese Aufnahme wird endgültig gelöscht.'))) return;
        if (player.id === tid) stopPlayback();
        const path = await api.rpc('admin_delete_take', { pw, tid }); await api.remove([path]).catch(() => {});
        return reload();
      }
      if (act === 'dl') {
        const x = takeOf(tid); const blob = await (await fetch(api.url(x.t.path))).blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(x.s, x.li, x.l, x.ti, x.t); a.click();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  v.addEventListener('input', (e) => { if (e.target.matches('textarea.inline-input')) autosize(e.target); });
  v.addEventListener('keydown', (e) => {
    if ((e.target.matches('textarea.inline-input') || e.target.matches('[data-lim]')) && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
  });
  v.addEventListener('focusout', async (e) => {
    const t = e.target;
    if (t.matches('[data-lim]')) {
      const row = t.closest('[data-lid]'); const lid = row.dataset.lid;
      const l = speakers.flatMap((s) => s.lines).find((x) => x.id === lid);
      const mn = parseSec(row.querySelector('[data-lim=min]').value), mx = parseSec(row.querySelector('[data-lim=max]').value);
      row.querySelector('[data-lim=min]').value = mn ?? ''; row.querySelector('[data-lim=max]').value = mx ?? '';
      if (!l || ((l.min_sec ?? null) === mn && (l.max_sec ?? null) === mx)) return;
      if (mn && mx && mn > mx) { t.closest('.limits').classList.remove('shake'); void t.offsetWidth; t.closest('.limits').classList.add('shake'); return toast('Minimum ist größer als Maximum', 'warn'); }
      try {
        await api.rpc('admin_set_line_limits', { pw, lid, new_min: mn, new_max: mx });
        l.min_sec = mn; l.max_sec = mx; toast(mn || mx ? `Länge: ${limitText(l)}` : 'Keine Längenvorgabe', 'ok', 1500);
      } catch (err) { toast(/Datenbank nicht eingerichtet/.test(err.message) ? 'Bitte zuerst UPDATE-1-laenge.sql in Supabase ausführen' : err.message, 'err', 4500); }
      return;
    }
    if (!t.matches('textarea.inline-input')) return;
    const lid = t.closest('[data-lid]').dataset.lid;
    const l = speakers.flatMap((s) => s.lines).find((x) => x.id === lid);
    const val = t.dataset.field === 'text' ? t.value.trim() : t.value.trim();
    if (!l || val === l[t.dataset.field]) return;
    if (t.dataset.field === 'text' && !val) { t.value = l.text; autosize(t); return toast('Line darf nicht leer sein', 'warn'); }
    try {
      await api.rpc('admin_update_line', { pw, lid, new_text: t.dataset.field === 'text' ? val : null, new_note: t.dataset.field === 'note' ? val : null });
      l[t.dataset.field] = val; toast('Gespeichert', 'ok', 1200);
    } catch (err) { toast(err.message, 'err'); }
  });

  // Alle 20 s still aktualisieren (nicht beim Tippen / Abspielen)
  const iv = setInterval(() => {
    if (document.hidden || openSheetEl || !player.audio.paused || document.activeElement?.matches('textarea, input')) return;
    reload(true);
  }, 20000);
  const prev = cleanup; cleanup = () => { prev && prev(); clearInterval(iv); };
  render();
}

route();
