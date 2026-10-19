// Shared code for the ViCollab app screens: nav + sidebar, theme, toasts,
// mock GitHub connection state, calls to the scoring API, charts and empty states.
const Mock = window.VicollabMock;
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- small helpers ---------- */
const fmt = {
  n: (x) => Number(x).toLocaleString('en-IN'),
  one: (x) => Number(x).toFixed(1),
  day: (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  short: (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  time: (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  ago(d, now = Date.now()) {
    const s = Math.round((now - new Date(d)) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const days = Math.round(s / 86400);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  },
};
const member = (login) => Mock.members.find((m) => m.login === login);
const initials = (name) => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const nameOf = (login) => (member(login) ? member(login).name : login);
// API warnings use GitHub logins; show people's names instead
const friendly = (text) => Mock.members.reduce((t, m) => t.split(m.login).join(m.name), text);

/* ---------- saved state (localStorage, but the app still works if it is blocked) ---------- */
const KEY = 'vicollab.github';
const DEFAULT_STATE = { connected: false, login: null, repo: 'mrinalg297/vicollab', syncedRepo: null, lastSynced: null, lastError: null, failNext: false };
let memoryState = null;
function getState() {
  try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT_STATE, ...(memoryState || {}) }; }
}
function setState(patch) {
  const next = { ...getState(), ...patch };
  memoryState = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: keep it in memory */ }
  document.dispatchEvent(new CustomEvent('statechange', { detail: next }));
  renderBadge();
  return next;
}
const repoData = (name) => Mock.repos.find((r) => r.fullName === name);
// commits the app has "synced" from GitHub, or null if nothing has been synced yet
function syncedCommits() {
  const s = getState();
  return s.connected && s.syncedRepo ? repoData(s.syncedRepo).commits : null;
}

/* ---------- mock OAuth + sync ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mockConnect() {
  await wait(900);
  return setState({ connected: true, login: Mock.team.viewer, lastError: null });
}
async function mockSync() {
  const s = getState();
  await wait(1400);
  if (s.failNext) {
    const msg = 'GitHub returned 503 Service Unavailable while listing commits';
    setState({ lastError: { message: msg, at: new Date().toISOString(), repo: s.repo }, failNext: false });
    throw new Error(msg);
  }
  return setState({ syncedRepo: s.repo, lastSynced: new Date().toISOString(), lastError: null });
}

/* ---------- scoring API ---------- */
async function scoreApi(body) {
  try {
    const res = await fetch('/api/contributions/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: 'The server did not return JSON' }));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the scoring service. Is the server running (npm start)?' } };
  }
}

/* ---------- date range shared between dashboard and member pages ---------- */
const RANGE_KEY = 'vicollab.range';
function getRange() {
  const q = new URLSearchParams(location.search);
  if (q.get('since') || q.get('until')) return { since: q.get('since') || '', until: q.get('until') || '' };
  try { const r = JSON.parse(sessionStorage.getItem(RANGE_KEY)); if (r) return r; } catch { /* ignore */ }
  return { since: Mock.range.start, until: Mock.range.end };
}
function saveRange(r) {
  try { sessionStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch { /* ignore */ }
  const q = new URLSearchParams(location.search);
  q.set('since', r.since); q.set('until', r.until);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
const rangeQuery = () => { const r = getRange(); return `since=${r.since}&until=${r.until}`; };
// returns an error message, or '' if the range is fine
function checkRange({ since, until }) {
  if (!since || !until) return 'Pick both a start and an end date.';
  if (since > until) return `The start date (${fmt.day(since)}) is after the end date (${fmt.day(until)}).`;
  return '';
}

/* ---------- theme ---------- */
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('vicollab.theme', next); } catch { /* ignore */ }
  const b = $('#theme');
  b.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} mode`);
  b.textContent = next === 'dark' ? '☀' : '☾';
}

/* ---------- shell: top nav + sidebar, the same on every screen ---------- */
const LOGO = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect width="11" height="11" rx="2" fill="#3040FF"/><rect x="13" width="11" height="11" rx="2" fill="#82DDB5"/><rect y="13" width="11" height="11" rx="2" fill="#C8F0DC"/><rect x="13" y="13" width="11" height="11" rx="2" fill="#2FCB8A"/></svg>';

function shell(active) {
  const cur = (id) => (id === active ? ' aria-current="page"' : '');
  const theme = currentTheme();
  document.body.insertAdjacentHTML('afterbegin', `
    <a class="skip" href="#main">Skip to content</a>
    <header class="top">
      <button class="btn ghost icon menu" id="menu" aria-label="Open menu" aria-expanded="false" aria-controls="side">☰</button>
      <a class="logo" href="../ViCollab_Home_Page.html">${LOGO}ViCollab</a>
      <nav aria-label="Main">
        <a href="dashboard.html"${cur('dashboard')}>Dashboard</a>
        <a href="connect.html"${cur('connect')}>GitHub</a>
        <a href="../ViCollab_Home_Page.html">Home</a>
      </nav>
      <span class="grow"></span>
      <a href="connect.html" id="gh-badge" class="badge"></a>
      <button class="btn ghost icon" id="theme" aria-label="Switch to ${theme === 'dark' ? 'light' : 'dark'} mode">${theme === 'dark' ? '☀' : '☾'}</button>
    </header>
    <div class="shell">
      <aside class="side" id="side" aria-label="Sections">
        <h2>Workspace</h2>
        <a href="connect.html"${cur('connect')}><span class="ic" aria-hidden="true">⌥</span>Connect GitHub</a>
        <a href="dashboard.html"${cur('dashboard')}><span class="ic" aria-hidden="true">▤</span>Contribution dashboard</a>
        <h2>Members</h2>
        ${Mock.members.map((m) => `<a href="member.html?m=${m.login}" data-member="${m.login}"${cur('member:' + m.login)}><span class="av" aria-hidden="true">${initials(m.name)}</span>${esc(m.name)}</a>`).join('')}
        <h2>More</h2>
        <a href="states.html"${cur('states')}><span class="ic" aria-hidden="true">◌</span>Empty &amp; error states</a>
      </aside>
      <div id="main-wrap" style="min-width:0"></div>
    </div>
    <div id="toasts" aria-live="polite"></div>`);
  // move the page's <main> into the shell
  $('#main-wrap').append($('main'));
  $('main').id = 'main';
  $('main').tabIndex = -1;

  // member links keep the chosen date range
  $$('[data-member]').forEach((a) => (a.href = `member.html?m=${a.dataset.member}&${rangeQuery()}`));

  $('#theme').onclick = toggleTheme;
  const side = $('#side'), menu = $('#menu');
  const close = () => { side.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
  menu.onclick = () => {
    const open = side.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    if (open) $('a', side).focus();
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && side.classList.contains('open')) { close(); menu.focus(); } });
  document.addEventListener('click', (e) => { if (side.classList.contains('open') && !side.contains(e.target) && e.target !== menu) close(); });
  renderBadge();
}

function renderBadge() {
  const b = $('#gh-badge');
  if (!b) return;
  const s = getState();
  let cls = 'off', text = 'GitHub not linked';
  if (s.connected && s.lastError) { cls = 'off'; text = 'Last sync failed'; }
  else if (s.connected && s.syncedRepo) { cls = 'ok'; text = `${s.syncedRepo.split('/')[1]} · synced`; }
  else if (s.connected) { cls = 'wait'; text = 'Connected · not synced'; }
  b.className = `badge ${cls}`;
  b.innerHTML = `<span>${esc(text)}</span>`;
  b.setAttribute('aria-label', `GitHub status: ${text}. Open GitHub settings`);
}

/* ---------- toasts ---------- */
function toast(title, text = '', type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', type === 'err' ? 'alert' : 'status');
  t.innerHTML = `<span aria-hidden="true">${type === 'err' ? '⚠' : '✓'}</span><div><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div><button aria-label="Dismiss">×</button>`;
  $('button', t).onclick = () => t.remove();
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 8000 : 4500);
}

/* ---------- empty / error state block ---------- */
// actions: [{ label, href } or { label, onClick }]; the first one is the primary button
function stateBlock(el, { kind = '', icon, title, text, actions = [] }) {
  el.innerHTML = `<div class="state ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">
    <div class="art" aria-hidden="true">${icon}</div><h2>${esc(title)}</h2><p>${text}</p>
    <div class="acts">${actions.map((a, i) => a.href
      ? `<a class="btn${i ? ' ghost' : ''}" href="${a.href}">${esc(a.label)}</a>`
      : `<button class="btn${i ? ' ghost' : ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
  actions.forEach((a, i) => { if (a.onClick) $(`[data-act="${i}"]`, el).onclick = a.onClick; });
}
// the four standard states, used on the dashboard, member page and states screen
const STATES = {
  notLinked: () => ({ icon: '🔗', title: 'GitHub is not linked yet', text: 'Connect your GitHub account and pick the team repository. ViCollab only reads commits, it never writes to your repos.', actions: [{ label: 'Connect GitHub', href: 'connect.html' }] }),
  notSynced: (onSync) => ({ kind: 'warn', icon: '⟳', title: 'No commits synced yet', text: `You're connected as <b>@${esc(getState().login)}</b>, but no repository has been synced. Sync to pull in the team's commits.`, actions: [{ label: 'Sync now', onClick: onSync }, { label: 'Choose another repo', href: 'connect.html' }] }),
  noCommits: (range, onReset) => ({ icon: '📭', title: 'No commits in this date range', text: `Nobody on the team committed between <b>${fmt.day(range.since)}</b> and <b>${fmt.day(range.until)}</b>. Try a wider range.`, actions: [{ label: 'Show all 12 weeks', onClick: onReset }] }),
  emptyRepo: (repo) => ({ icon: '📭', title: 'This repository has no commits', text: `<code>${esc(repo)}</code> is empty, so there is nothing to score. Pick the team's main repository instead.`, actions: [{ label: 'Change repository', href: 'connect.html' }] }),
  syncFailed: (err, onRetry) => ({ kind: 'err', icon: '⚠', title: 'Sync failed', text: `${esc(err)}. Your last good data is kept. Wait a moment and try again.`, actions: [{ label: 'Retry sync', onClick: onRetry }, { label: 'GitHub settings', href: 'connect.html' }] }),
  badRange: (msg, onFix) => ({ kind: 'warn', icon: '📅', title: 'That date range doesn\'t work', text: `${esc(msg)} Change the dates above, or reset to the full project.`, actions: [{ label: 'Reset to all 12 weeks', onClick: onFix }] }),
  apiError: (msg, onRetry) => ({ kind: 'err', icon: '⚠', title: 'Couldn\'t calculate scores', text: esc(msg), actions: [{ label: 'Try again', onClick: onRetry }] }),
};

/* ---------- column chart (SVG), with hover + keyboard tooltips ---------- */
// data: [{ label, value, tip }]
function columnChart(el, data, { height = 200 } = {}) {
  // draw at the container's real width so the 11px labels stay 11px on a phone
  const W = Math.max(300, Math.round(el.clientWidth || 640)), H = height, padL = 30, padB = 26, padT = 18;
  if (!el._ro) {
    el._ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - el._w) > 8) columnChart(el, el._data, el._opts); });
    el._ro.observe(el);
  }
  el._data = data; el._opts = { height }; el._w = W;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const slot = (W - padL) / data.length, bw = Math.min(24, slot * 0.6);
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(el.dataset.label || 'Column chart')}">`;
  for (let v = 0; v <= top; v += step) svg += `<line class="gl" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  data.forEach((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2, h = y(0) - y(d.value), r = Math.min(4, h);
    const path = d.value ? `M${x},${y(0)} V${y(d.value) + r} q0,-${r} ${r},-${r} h${bw - 2 * r} q${r},0 ${r},${r} V${y(0)} Z` : '';
    svg += `<g><rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${H - padT - padB}" tabindex="0" role="img" data-i="${i}" aria-label="${esc(d.tip.replace(/<[^>]+>/g, ' '))}"/>`;
    svg += `${path ? `<path class="col" d="${path}"/>` : `<rect class="col" x="${x}" y="${y(0) - 1}" width="${bw}" height="1" opacity=".5"/>`}</g>`;
    if (slot >= 28 || i % 2 === 0) svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  svg += '</svg><div class="tip" aria-hidden="true"></div>';
  el.innerHTML = svg;
  const tip = $('.tip', el);
  const show = (rect) => {
    const d = data[rect.dataset.i], box = el.getBoundingClientRect(), r = rect.getBoundingClientRect();
    tip.innerHTML = d.tip;
    tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, 70), box.width - 70)}px`;
    tip.style.top = `${$$('.col', el)[rect.dataset.i].getBoundingClientRect().top - box.top}px`;
    tip.classList.add('on');
  };
  $$('.hit', el).forEach((r) => {
    r.addEventListener('pointerenter', () => show(r));
    r.addEventListener('focus', () => show(r));
    r.addEventListener('pointerleave', () => tip.classList.remove('on'));
    r.addEventListener('blur', () => tip.classList.remove('on'));
  });
}

/* ---------- csv download ---------- */
function downloadCsv(filename, rows) {
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const blob = new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// week index (0-11) of a commit date
const weekOf = (date) => Math.floor((Date.parse(date) - Mock.range.weekStart(0)) / (7 * 864e5));
const isMerge = (c) => /^Merge\b/.test(c.message || '');

/* ---------- date range controls (same widget on dashboard and member pages) ---------- */
// el gets: since/until inputs + preset chips. onChange(range) runs after each valid or invalid change.
function rangeControls(el, onChange) {
  const r = getRange();
  el.innerHTML = `
    <div class="field"><label for="since">From</label><input type="date" id="since" min="2026-01-01" max="2026-12-31" value="${r.since}" aria-describedby="range-msg"></div>
    <div class="field"><label for="until">To</label><input type="date" id="until" min="2026-01-01" max="2026-12-31" value="${r.until}" aria-describedby="range-msg"></div>
    <div class="field" style="flex:2"><label id="preset-label">Quick ranges</label>
      <div class="chips" role="group" aria-labelledby="preset-label">${Mock.range.presets.map((p) => `<button type="button" class="chip" data-since="${p.since}" data-until="${p.until}">${esc(p.label)}</button>`).join('')}</div></div>`;
  const since = $('#since', el), until = $('#until', el);
  const sync = () => {
    $$('.chip', el).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.since === since.value && c.dataset.until === until.value)));
    const bad = checkRange({ since: since.value, until: until.value });
    [since, until].forEach((i) => i.setAttribute('aria-invalid', String(!!bad)));
    return bad;
  };
  const fire = () => {
    const range = { since: since.value, until: until.value };
    const bad = sync();
    if (!bad) saveRange(range);
    onChange(range, bad);
  };
  since.addEventListener('change', fire);
  until.addEventListener('change', fire);
  $$('.chip', el).forEach((c) => (c.onclick = () => { since.value = c.dataset.since; until.value = c.dataset.until; fire(); }));
  sync();
  return {
    set(range) { since.value = range.since; until.value = range.until; fire(); },
    get: () => ({ since: since.value, until: until.value }),
  };
}
