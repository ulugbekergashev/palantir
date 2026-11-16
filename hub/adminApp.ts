/**
 * Boshqaruv markazi (/admin) — asosiy qism: kirish, holat, «Umumiy» (ko'rsatkichlar, grafik, diqqat ro'yxati, turlar, nashrlar, to'lovlar)
 * va «Mijozlar» jadvali. Mijoz oynasi, yordam, jamoa va jurnal — adminDrawer.ts. Ikkalasi admin.ts da bitta <script> ga qo'shiladi.
 * Ma'lumot faqat textContent bilan chiqadi (klinika nomi va holati — klinikadan kelgan, ishonib bo'lmaydi). Kalit faqat o'zgaruvchida.
 */
export const ADMIN_APP_JS = String.raw`
const $ = id => document.getElementById(id);
// Kirish kaliti (yoki asosiy kalit) va kimligi — faqat sahifa xotirasida (brauzer xotirasiga yozilmaydi, yangi oynaga o'tmaydi)
let adminKey = null, me = null;
let data = { clinics: [], latest: null, history: [] };
let helpRows = [];
let view = 'overview';
const filters = { kind: 'all', state: 'all', q: '' };
const founder = () => !!me && me.role === 'founder';
const ROLE = { founder: 'asoschi', installer: "o'rnatuvchi" };
const KIND = { clinic: 'Klinika', education: "O'quv markazi", services: 'Xizmat', manufacturing: 'Ishlab chiqarish', retail: 'Savdo' };
const KIND_ORDER = ['clinic', 'education', 'services', 'manufacturing', 'retail'];
/** Disk shundan kam qolsa — ogohlantirish (zaxira va yangilanish joy talab qiladi) */
const LOW_DISK_MB = 2048;
const DAY_MS = 86400000;

const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined && text !== null) x.textContent = String(text); return x; };
const api = (path, body) => fetch(path, {
  method: body ? 'POST' : 'GET',
  headers: { authorization: 'Bearer ' + adminKey, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
let toastTimer = null;
function say(t) {
  const box = $('toast');
  if (!t) { box.hidden = true; return; }
  box.textContent = t;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, Math.min(12000, 3500 + t.length * 45));
}
const ago = iso => {
  if (!iso) return "hali ko'rinmagan";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'hozirgina' : m < 60 ? m + ' daqiqa oldin' : m < 1440 ? Math.round(m / 60) + ' soat oldin' : Math.round(m / 1440) + ' kun oldin';
};
const dateText = iso => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const money = n => Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ') + " so'm";
const daysTo = day => Math.ceil((Date.parse(day + 'T23:59:59') - Date.now()) / DAY_MS);
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const kindOf = c => (c.card && c.card.kind) || (c.status && c.status.kinds && c.status.kinds[0]) || null;
const titleOf = c => c.name + (c.status && c.status.label && c.status.label !== c.name ? ' — ' + c.status.label : '');
const unanswered = id => helpRows.filter(h => h.clinicId === id && !h.answer).length;
/** Eng so'nggi nashr: Hub manifestdan oladi; ololmasa — mijozlardagi eng yangisi */
const latestVersion = () => data.latest || data.clinics.reduce((v, c) => (c.status && c.status.version && (!v || cmpVer(c.status.version, v) > 0) ? c.status.version : v), null);

/** Mijozning diqqat talab qiladigan holatlari: high — hozir buzuq, mid — tez orada, low — eslatma */
function alertsOf(c) {
  const out = [], s = c.status;
  const add = (level, text) => out.push({ level, text });
  if (!c.approved) add('mid', 'Tasdiqlanmagan — kompyuter kodini tekshirib tasdiqlang');
  else if (!c.online) add('high', "Aloqa yo'q — " + ago(c.seenAt));
  const help = unanswered(c.id);
  if (help) add('high', help + " ta yordam so'rovi javobsiz");
  if (s) {
    for (const p of s.problems || []) add('high', (p.business && p.business !== c.name ? p.business + ' — ' : '') + (p.label ? p.label + ': ' : '') + (p.problem || ''));
    if (s.lastUpdate && s.lastUpdate.result && s.lastUpdate.result !== 'ok') add('high', 'Yangilanish ' + (s.lastUpdate.to ? 'v' + s.lastUpdate.to + ' ' : '') + '— ' + s.lastUpdate.result + (s.lastUpdate.reason ? ': ' + s.lastUpdate.reason : ''));
    if (s.lastOffsite && !s.lastOffsite.ok) add('mid', 'Tashqi zaxira yuborilmadi (' + (s.lastOffsite.day || '') + '): ' + (s.lastOffsite.error || "sababi yo'q"));
    if (typeof s.diskFreeMb === 'number' && s.diskFreeMb < LOW_DISK_MB) add('mid', 'Diskda ' + (s.diskFreeMb / 1024).toFixed(1) + ' GB qoldi');
    const lic = s.license;
    if (c.approved && lic && !lic.activated && typeof lic.daysLeft === 'number') add(lic.daysLeft <= 7 ? 'high' : lic.daysLeft <= 14 ? 'mid' : 'low', 'Litsenziyasiz — ' + lic.daysLeft + ' kun qoldi');
    const latest = latestVersion();
    if (c.approved && latest && s.version && cmpVer(s.version, latest) < 0) add('low', 'Eski nashr v' + s.version + ' (so\'nggisi v' + latest + ')');
  }
  if (c.card && c.card.paidUntil) {
    const d = daysTo(c.card.paidUntil);
    if (d < 0) add('mid', "To'lov muddati o'tgan — " + dateText(c.card.paidUntil));
    else if (d <= 5) add('low', "To'lov muddati " + d + ' kunda — ' + dateText(c.card.paidUntil));
  }
  return out;
}
const RANK = { high: 0, mid: 1, low: 2 };
/** Jadvaldagi holat: off — aloqa yo'q, bad — muammo, new — tasdiqlanmagan/sozlanmoqda, on — joyida */
function stateOf(c) {
  if (!c.approved) return 'new';
  if (!c.online) return 'off';
  if (alertsOf(c).some(a => a.level === 'high')) return 'bad';
  if (c.status && c.status.setup) return 'new';
  return 'on';
}

async function load() {
  const r = await api('/admin/clinics').catch(() => null);
  if (!r) return say("Hub bilan aloqa yo'q");
  if (r.status === 401) { signedOut(); return say('Kirish tugadi — qayta kiring'); }
  if (!r.ok) return say('Xato: ' + r.status);
  data = await r.json();
  const h = await api('/admin/help').catch(() => null);
  if (h && h.ok) helpRows = (await h.json()).help;
  render();
}

function render() {
  const open = helpRows.filter(h => !h.answer).length;
  $('helpBadge').textContent = open;
  $('helpBadge').hidden = !open;
  if (view === 'overview') renderOverview();
  if (view === 'clients') renderClients();
  if (view === 'help' && !busyWithHelp()) renderHelp();
  refreshDrawer();
}

function show(next) {
  view = next;
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-current', b.dataset.view === next ? 'page' : 'false');
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'v-' + next;
  if (next === 'team') members();
  else if (next === 'audit') audit();
  else render();
}

// ─── Umumiy ───
function kpi(label, value, note, cls, onClick) {
  const b = el('button', 'kpi' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  b.append(el('span', '', label), el('b', 'num', value), el('small', '', note));
  b.onclick = onClick;
  return b;
}

function renderOverview() {
  const all = data.clinics, live = all.filter(c => c.approved), pending = all.length - live.length;
  const online = live.filter(c => c.online).length;
  const troubled = all.filter(c => alertsOf(c).some(a => a.level !== 'low'));
  const open = helpRows.filter(h => !h.answer).length;
  const lics = live.filter(c => c.status && c.status.license);
  const activated = lics.filter(c => c.status.license.activated).length;
  const soon = lics.filter(c => !c.status.license.activated && c.status.license.daysLeft !== null && c.status.license.daysLeft <= 14).length;
  const latest = latestVersion();
  const fresh = live.filter(c => c.status && c.status.version && latest && cmpVer(c.status.version, latest) >= 0).length;
  const goClients = state => () => { filters.state = state; filters.kind = 'all'; show('clients'); };
  $('kpis').replaceChildren(
    kpi('Mijozlar', live.length, pending ? pending + ' ta tasdiq kutyapti' : 'hammasi tasdiqlangan', '', goClients('all')),
    kpi('Aloqada', online + ' / ' + live.length, live.length ? Math.round(online * 100 / live.length) + '% hozir ishlayapti' : "hali mijoz yo'q", live.length && online === live.length ? 'ok' : online < live.length ? 'warn' : '', goClients('off')),
    kpi('Diqqat kerak', troubled.length, troubled.length ? 'muammo yoki xavf bor' : 'hammasi joyida', troubled.length ? 'bad' : 'ok', goClients('trouble')),
    kpi("Yordam so'rovlari", open, open ? 'javob kutyapti' : "javobsiz so'rov yo'q", open ? 'bad' : '', () => show('help')),
    kpi('Litsenziya', activated + ' / ' + lics.length, soon ? soon + ' tasida 14 kundan kam qoldi' : 'muddati yaqin yo\'q', soon ? 'warn' : '', goClients('license')),
    kpi('Nashr', latest ? 'v' + latest : '—', live.length ? fresh + ' / ' + live.length + ' tasi so\'nggisida' : '', live.length && fresh < live.length ? 'warn' : '', goClients('old')),
  );
  chart();
  attention(all);
  kinds(live);
  versions(live, latest);
  payments(live);
}

function chart() {
  const box = $('chart'), h = data.history || [];
  $('chartCard').hidden = !founder();
  if (h.length < 2) { box.replaceChildren(el('div', 'empty', "Grafik bir-ikki kunda to'ladi — Hub har soatda ko'rsatkichni yozib boradi")); return; }
  const NS = 'http://www.w3.org/2000/svg', W = 600, H = 190, L = 28, R = 8, T = 10, B = 24;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', "14 kun: aloqadagi va muammoli mijozlar");
  const max = Math.max(1, ...h.map(d => d.total));
  const x = i => L + (W - L - R) * (h.length === 1 ? 0 : i / (h.length - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const node = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  for (const v of [0, Math.ceil(max / 2), max]) {
    node('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'axis', 'stroke-dasharray': v ? '3 4' : '' });
    node('text', { x: L - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'lbl' }).textContent = v;
  }
  const bw = Math.max(4, (W - L - R) / h.length * 0.45);
  h.forEach((d, i) => { if (d.problems) node('rect', { x: x(i) - bw / 2, y: y(d.problems), width: bw, height: y(0) - y(d.problems), rx: 2, fill: 'var(--bad)', opacity: '.35' }); });
  const path = key => h.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d[key]).toFixed(1)).join(' ');
  node('path', { d: path('total'), fill: 'none', stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' });
  node('path', { d: path('online') + ' L' + x(h.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z', fill: 'var(--accent-soft)' });
  node('path', { d: path('online'), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
  h.forEach((d, i) => {
    if (h.length > 8 && i % 2 && i !== h.length - 1) return;
    node('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'lbl' }).textContent = d.day.slice(8, 10) + '.' + d.day.slice(5, 7);
  });
  box.replaceChildren(svg);
}

function attention(all) {
  const items = [];
  for (const c of all) for (const a of alertsOf(c)) items.push({ c, a });
  items.sort((p, q) => RANK[p.a.level] - RANK[q.a.level]);
  const box = $('attention');
  $('attentionCount').textContent = items.length ? items.length + ' ta' : '';
  if (!items.length) { $('attentionMore').hidden = true; box.replaceChildren(el('li', 'empty', "Hammasi joyida — diqqat talab qiladigan narsa yo'q")); return; }
  const SHOWN = 6;
  const more = $('attentionMore');
  more.hidden = items.length <= SHOWN;
  more.textContent = 'Yana ' + (items.length - SHOWN) + " ta — hammasi Mijozlar ro'yxatida →";
  more.onclick = () => { filters.state = 'trouble'; filters.kind = 'all'; show('clients'); };
  box.replaceChildren(...items.slice(0, SHOWN).map(({ c, a }) => {
    const li = el('li');
    li.tabIndex = 0;
    const what = el('div', 'what');
    what.append(el('b', '', titleOf(c)), el('small', '', a.text));
    li.append(el('span', 'lvl ' + a.level), what);
    li.onclick = () => openClient(c.id);
    li.onkeydown = e => { if (e.key === 'Enter') openClient(c.id); };
    return li;
  }));
}

function barRow(label, n, total, cls) {
  const row = el('div', 'bar'), track = el('div', 'track'), fill = el('div', 'fill' + (cls ? ' ' + cls : ''));
  fill.style.width = (total ? Math.round(n * 100 / total) : 0) + '%';
  track.append(fill);
  row.append(el('span', '', label), track, el('b', 'num', n));
  return row;
}

function kinds(live) {
  const count = {};
  for (const c of live) { const k = kindOf(c) || 'unknown'; count[k] = (count[k] || 0) + 1; }
  const rows = KIND_ORDER.filter(k => count[k]).map(k => barRow(KIND[k], count[k], live.length));
  if (count.unknown) rows.push(barRow("Noma'lum", count.unknown, live.length, 'old'));
  $('kinds').replaceChildren(...(rows.length ? rows : [el('div', 'empty', "Hali mijoz yo'q")]));
}

function versions(live, latest) {
  const count = {};
  for (const c of live) { const v = (c.status && c.status.version) || '—'; count[v] = (count[v] || 0) + 1; }
  const list = Object.keys(count).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : cmpVer(b, a)));
  $('versions').replaceChildren(...(list.length ? list.slice(0, 6).map(v => barRow(v === '—' ? "ma'lum emas" : 'v' + v + (v === latest ? ' · so\'nggi' : ''), count[v], live.length, v === latest ? 'ok' : 'old')) : [el('div', 'empty', "Hali mijoz yo'q")]));
}

function payments(live) {
  $('payCard').hidden = !founder();
  if (!founder()) return;
  const paying = live.filter(c => c.card && c.card.plan);
  const monthly = paying.reduce((s, c) => s + c.card.plan, 0);
  const overdue = live.filter(c => c.card && c.card.paidUntil && daysTo(c.card.paidUntil) < 0);
  const soon = live.filter(c => c.card && c.card.paidUntil && daysTo(c.card.paidUntil) >= 0 && daysTo(c.card.paidUntil) <= 7);
  const cell = (label, value) => { const d = el('div'); d.append(el('span', '', label), el('b', 'num', value)); return d; };
  $('money').replaceChildren(cell('Oylik tarif jami', paying.length ? money(monthly) : '—'), cell("Muddati o'tgan", overdue.length), cell('7 kunda to\'lov', soon.length));
  const items = [...overdue, ...soon].sort((a, b) => a.card.paidUntil.localeCompare(b.card.paidUntil));
  $('payList').replaceChildren(...(items.length ? items.slice(0, 6).map(c => {
    const li = el('li'), d = daysTo(c.card.paidUntil), what = el('div', 'what');
    li.tabIndex = 0;
    what.append(el('b', '', titleOf(c)), el('small', '', (d < 0 ? Math.abs(d) + " kun o'tdi" : d + ' kun qoldi') + ' · ' + dateText(c.card.paidUntil) + (c.card.plan ? ' · ' + money(c.card.plan) : '')));
    li.append(el('span', 'lvl ' + (d < 0 ? 'mid' : 'low')), what);
    li.onclick = () => openClient(c.id);
    li.onkeydown = e => { if (e.key === 'Enter') openClient(c.id); };
    return li;
  }) : [el('li', 'empty', paying.length ? "Muddati yaqin to'lov yo'q" : "Mijoz kartasida tarif va to'langan sanani yozing — shu yerda ko'rinadi")]));
}

// ─── Mijozlar ───
const STATES = { all: 'Hammasi', on: 'Aloqada', off: "Aloqa yo'q", trouble: 'Diqqat kerak', new: 'Tasdiqlanmagan yoki sozlanmoqda', license: 'Litsenziyasiz', old: 'Eski nashr', unpaid: "To'lov muddati o'tgan" };
function matches(c) {
  const k = kindOf(c) || 'unknown';
  if (filters.kind !== 'all' && k !== filters.kind) return false;
  const st = stateOf(c), al = alertsOf(c);
  const latest = latestVersion();
  const ok = {
    all: true, on: c.online && c.approved, off: c.approved && !c.online, trouble: al.some(a => a.level !== 'low'), new: st === 'new',
    license: !!(c.status && c.status.license && !c.status.license.activated), old: !!(latest && c.status && c.status.version && cmpVer(c.status.version, latest) < 0),
    unpaid: !!(c.card && c.card.paidUntil && daysTo(c.card.paidUntil) < 0),
  }[filters.state];
  if (!ok) return false;
  const q = filters.q.trim().toLowerCase();
  if (!q) return true;
  const card = c.card || {};
  return [c.name, c.status && c.status.label, card.owner, card.phone, card.city, c.machineId, c.status && (c.status.industries || []).join(' ')].some(v => v && String(v).toLowerCase().includes(q));
}

function renderClients() {
  const all = data.clinics;
  const count = { all: all.length };
  for (const c of all) { const k = kindOf(c) || 'unknown'; count[k] = (count[k] || 0) + 1; }
  const chips = ['all', ...KIND_ORDER.filter(k => count[k]), ...(count.unknown ? ['unknown'] : [])].map(k => {
    const b = el('button', 'chip', k === 'all' ? 'Hammasi' : k === 'unknown' ? "Noma'lum" : KIND[k]);
    b.type = 'button';
    b.append(el('small', 'num', count[k]));
    b.setAttribute('aria-pressed', String(filters.kind === k));
    b.onclick = () => { filters.kind = k; renderClients(); };
    return b;
  });
  $('kindChips').replaceChildren(...chips);
  $('stateSel').value = filters.state;
  $('newBox').hidden = false;
  $('claim').hidden = founder();
  const rows = all.filter(matches).sort((a, b) => {
    const s = { bad: 0, off: 1, new: 2, on: 3 };
    return s[stateOf(a)] - s[stateOf(b)] || a.name.localeCompare(b.name);
  });
  $('clientCount').textContent = rows.length === all.length ? all.length + ' ta mijoz' : rows.length + ' / ' + all.length + ' ta mijoz';
  $('rows').replaceChildren(...rows.map(clientRow));
  $('noRows').hidden = !!rows.length;
  $('noRows').textContent = all.length ? "Bu filtr bo'yicha mijoz yo'q" : "Hali mijoz yo'q — yangi o'rnatilgan kompyuter bu yerga o'zi tushadi";
}

function cellOf(label, ...parts) {
  const td = el('td');
  td.dataset.l = label;
  td.append(...parts);
  return td;
}

function clientRow(c) {
  const tr = el('tr'), st = stateOf(c), al = alertsOf(c), s = c.status || {}, card = c.card || {};
  tr.tabIndex = 0;
  const dot = el('span', 'dot ' + st);
  dot.title = { on: 'aloqada', off: "aloqa yo'q", bad: 'muammo bor', new: 'tasdiqlanmagan yoki sozlanmoqda' }[st];
  const name = el('div');
  name.append(el('div', 'nm', titleOf(c)), el('small', '', card.owner || card.phone ? [card.owner, card.phone].filter(Boolean).join(' · ') : (c.machineId || '')));
  const lic = s.license;
  const licPill = !lic ? el('span', 'pill', '—') : lic.activated ? el('span', 'pill ok', 'bor') : el('span', 'pill ' + (lic.daysLeft <= 7 ? 'bad' : 'warn'), lic.daysLeft + ' kun');
  const latest = latestVersion();
  const ver = s.version ? el('span', 'pill ' + (latest && cmpVer(s.version, latest) < 0 ? 'warn' : ''), 'v' + s.version) : el('span', 'pill', '—');
  const paid = card.paidUntil ? el('span', 'pill ' + (daysTo(card.paidUntil) < 0 ? 'bad' : daysTo(card.paidUntil) <= 5 ? 'warn' : 'ok'), dateText(card.paidUntil)) : el('span', 'pill', '—');
  const high = al.filter(a => a.level !== 'low');
  const issue = high.length ? el('span', 'pill bad', high.length + ' ta') : el('span', 'pill ok', "yo'q");
  issue.title = high.map(a => a.text).join('\n');
  const seen = el('span', '', c.online ? 'aloqada' : ago(c.seenAt));
  tr.append(cellOf('', dot), cellOf('', name), cellOf('Turi', el('span', '', KIND[kindOf(c)] || '—')), cellOf('Shahar', el('span', '', card.city || '—')),
    cellOf('Aloqa', seen), cellOf('Nashr', ver), cellOf('Litsenziya', licPill), cellOf("To'lov", paid), cellOf('Diqqat', issue));
  tr.onclick = () => openClient(c.id);
  tr.onkeydown = e => { if (e.key === 'Enter') openClient(c.id); };
  return tr;
}

$('q').oninput = () => { filters.q = $('q').value; renderClients(); };
$('stateSel').onchange = () => { filters.state = $('stateSel').value; renderClients(); };
for (const [k, v] of Object.entries(STATES)) { const o = el('option', '', v); o.value = k; $('stateSel').append(o); }
for (const b of document.querySelectorAll('nav button')) b.onclick = () => show(b.dataset.view);

// ─── Kirish ───
function signedOut() {
  adminKey = null;
  me = null;
  data = { clinics: [], latest: null, history: [] };
  helpRows = [];
  closeClient();
  $('app').hidden = true;
  $('login').hidden = false;
}

// Login bo'sh — parol maydonidagi asosiy kalit (HUB_ADMIN_KEY); aks holda shaxsiy hisob
$('key').onsubmit = async e => {
  e.preventDefault();
  const login = $('lg').value.trim(), secret = $('k').value;
  $('k').value = '';
  const b = $('key').querySelector('button');
  b.disabled = true;
  try {
    if (login) {
      const r = await fetch('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: secret }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) return say(j.error || 'Xato: ' + r.status);
      adminKey = j.token;
    } else adminKey = secret.trim();
    const r = await api('/admin/me');
    if (!r.ok) { signedOut(); return say(login ? "Kirib bo'lmadi" : "Asosiy kalit noto'g'ri"); }
    me = (await r.json()).member;
    $('meName').textContent = me.name;
    $('meRole').textContent = ROLE[me.role] || me.role;
    for (const id of ['navTeam', 'navAudit']) $(id).hidden = !founder();
    // Asosiy kalitning paroli yo'q (u Hub sozlamasida)
    $('pw').hidden = me.id === 'kalit';
    $('login').hidden = true;
    $('app').hidden = false;
    say('');
    show('overview');
    load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    b.disabled = false;
  }
};
$('out').onclick = () => { signedOut(); say(''); };
$('pw').onclick = () => { $('pwf').hidden = !$('pwf').hidden; };
$('pwf').onsubmit = async e => {
  e.preventDefault();
  const r = await api('/admin/me/password', { current: $('pw1').value, next: $('pw2').value }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  $('pw1').value = $('pw2').value = '';
  if (r && r.ok && j.token) { adminKey = j.token; $('pwf').hidden = true; return say('Parol almashdi — boshqa qurilmalardagi kirishlar tugadi'); }
  say(j.error || "Hub bilan aloqa yo'q");
};
`;
