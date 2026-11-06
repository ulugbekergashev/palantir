/**
 * Sotuvchining sahifasi (/admin): klinikalar — aloqadami, nashri — va «Panelni ochish». Tugma hubdan kirish kalitini so'raydi
 * (POST /admin/clinics/<klinika>/panel, admin kaliti bilan), klinika uni egasi ruxsat bergan bo'lsa beradi, panel yangi oynada
 * kalit bilan ochiladi (#kirish=…, src/lib/telegramLaunch.ts). Sahifada sir yo'q. Klinika nomlari faqat textContent bilan chiqadi.
 *
 * Klinika panellari (/c/…) shu manzilda turadi va ularni klinika kompyuteri beradi — buzilgan klinika o'z sahifasidan admin kalitini
 * o'qishga urinishi mumkin. Shuning uchun: kalit faqat sahifa xotirasida (o'zgaruvchida, brauzer xotirasida emas — yangi oynaga
 * nusxalanmaydi), panel oynasi ochuvchisiz (opener = null) va sahifada Cross-Origin-Opener-Policy (hub/server.ts) — panel bu
 * sahifaga qo'l cho'za olmaydi. Sahifa yangilansa, kalit qayta so'raladi.
 *
 * Asosiy yo'l: yangi o'rnatilgan kompyuter o'zi ulanadi va «tasdiqlanmagan» bo'ladi (hub/server.ts, 11-band). «Tasdiqlash va
 * aktivlashtirish» — klinika ekranidagi kompyuter kodini kiritasiz (kod yozuvnikiga mos kelishi kerak), shu bosishda litsenziya ham
 * beriladi; bir xil kodli bir nechta yozuv bo'lsa ogohlantiriladi. Soxta yozuv — «O'chirish».
 *
 * «Yangi klinika» — zaxira yo'l (kompyuter o'zi ulana olmasa): yozuv tasdiqlangan holda ochiladi va ulanish kodi BIR MARTA
 * ko'rsatiladi (hubda faqat xeshi); o'rnatuvchi uni ulash ustasining «Kalitlar» maydoniga qo'yadi. Egasiga topshirilmagan klinika
 * (holatda setup) — «Sozlash»: panel so'ramasdan ochiladi va ulash ustasiga o'tadi (klinika tomoni: server/profile.ts).
 *
 * Kirish — har kishining o'z logini va paroli (hub/team.ts): kalit sahifa xotirasida, 12 soat. Login bo'sh qoldirilsa — parol
 * o'rniga asosiy kalit (HUB_ADMIN_KEY): birinchi asoschini ochish va favqulodda. Asoschi «Jamoa» (hisoblar: yangi, yangi parol,
 * yopish) va «Jurnal» (kim, qachon, qaysi klinikaga nima qildi) ni ko'radi; o'rnatuvchiga tasdiqlash, o'chirish va litsenziya yo'q.
 */

export function adminPage(): string {
  return `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palantir klinikalari</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#13161d;--muted:#5b6170;--line:#e3e6eb;--accent:#3346d3;--ok:#12a150;--off:#9aa1ad}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c10;--card:#14161c;--ink:#f2f0ea;--muted:#8a909c;--line:#262a33;--accent:#8fa0ff;--ok:#34d399;--off:#4b5160}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:28px 16px 48px}
h1{font-size:1.35rem;margin:0 0 4px}
.lead{color:var(--muted);margin:0 0 18px}
form,li{background:var(--card);border:1px solid var(--line);border-radius:14px}
form{display:flex;gap:8px;padding:12px}
input{flex:1;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
button{padding:9px 14px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
@media (prefers-color-scheme:dark){button{color:#0b0c10}}
button:disabled{opacity:.4;cursor:default}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
li{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:12px 14px}
.who{flex:1;min-width:11rem}.who b{display:block}.who small{color:var(--muted)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--off);flex:none}.dot.on{background:var(--ok)}
.pick{display:flex;flex-wrap:wrap;gap:6px;width:100%}
.pick button,button.second{background:transparent;color:var(--accent);border:1px solid var(--line)}
#new{margin:0 0 10px}
.code{display:flex;flex-direction:column;gap:8px;background:var(--card);border:1px solid var(--accent);border-radius:14px;padding:12px 14px;margin:0 0 10px}
.code code{display:block;word-break:break-all;font:13px/1.4 ui-monospace,Consolas,monospace;padding:8px 10px;border:1px solid var(--line);border-radius:10px;user-select:all}
.code small{color:var(--muted)}
#msg{min-height:1.4em;margin:12px 0;color:var(--muted)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px}
.bar span{flex:1;min-width:10rem;color:var(--muted)}.bar b{color:var(--ink)}
.bar button,.mini{padding:6px 11px;font-size:14px}
section{margin:0 0 16px}
section h2{font-size:1.05rem;margin:0 0 8px}
select{padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;font:inherit}
.log li{display:block;padding:9px 12px;font-size:14px}.log small{color:var(--muted)}
.off{opacity:.55}
</style>
<main>
<h1>Palantir klinikalari</h1>
<p class="lead">Yangi o'rnatilgan kompyuter bu ro'yxatga o'zi tushadi («tasdiqlanmagan»). O'rnatuvchidan ekrandagi kompyuter kodini so'rab, «Tasdiqlash va aktivlashtirish»ni bosing — klinika ekrani o'zi ochiladi. Egasiga topshirilguncha «Sozlash» bilan masofadan so'ramasdan kirasiz; topshirilgandan keyin — egasining Telegram'dagi ruxsati bilan. Har kirish egasiga aytiladi.</p>
<form id="key" hidden><input id="lg" placeholder="Login (asosiy kalit bilan — bo'sh)" autocomplete="username" maxlength="40"><input id="k" type="password" placeholder="Parol" autocomplete="current-password" required><button>Kirish</button></form>
<div id="bar" class="bar" hidden><span id="me"></span><button class="second" id="tabTeam" hidden>Jamoa</button><button class="second" id="tabAudit" hidden>Jurnal</button><button class="second" id="pw">Parolim</button><button class="second" id="out">Chiqish</button></div>
<form id="pwf" hidden><input id="pw1" type="password" placeholder="Joriy parol" autocomplete="current-password" required><input id="pw2" type="password" placeholder="Yangi parol (10+ belgi)" autocomplete="new-password" minlength="10" required><button>Almashtirish</button></form>
<section id="team" hidden><h2>Jamoa</h2>
<form id="addm"><input id="mn" placeholder="Ismi" maxlength="60" required><input id="ml" placeholder="login" maxlength="32" pattern="[a-zA-Z0-9._\\-]{3,32}" required><select id="mr"><option value="installer">o'rnatuvchi</option><option value="founder">asoschi</option></select><button>Qo'shish</button></form>
<div id="mcode" class="code" hidden></div>
<ul id="members"></ul></section>
<section id="audit" hidden><h2>Jurnal</h2><ul id="log" class="log"></ul></section>
<form id="new" hidden><input id="nm" placeholder="Kompyuter o'zi ulana olmasa: klinika nomi" maxlength="80" required><button>Yangi klinika</button></form>
<div id="code" class="code" hidden></div>
<div id="msg" role="status"></div>
<ul id="list"></ul>
</main>
<script>
const $ = id => document.getElementById(id);
// Kirish kaliti (yoki asosiy kalit) va kimligi — faqat sahifa xotirasida
let adminKey = null, me = null;
const store = { get: () => adminKey, set: v => { adminKey = v || null; } };
const founder = () => !!me && me.role === 'founder';
const ROLE = { founder: 'asoschi', installer: "o'rnatuvchi" };
const say = t => { $('msg').textContent = t; };
const api = (path, body) => fetch(path, {
  method: body ? 'POST' : 'GET',
  headers: { authorization: 'Bearer ' + store.get(), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const ago = iso => {
  if (!iso) return "hali ko'rinmagan";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? m + ' daqiqa oldin' : m < 1440 ? Math.round(m / 60) + ' soat oldin' : Math.round(m / 1440) + ' kun oldin';
};
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; };

async function load() {
  const r = await api('/admin/clinics').catch(() => null);
  if (!r) return say("Hub bilan aloqa yo'q");
  if (r.status === 401) {
    signedOut();
    return say("Kirish tugadi — qayta kiring");
  }
  if (!r.ok) return say('Xato: ' + r.status);
  $('key').hidden = true;
  $('new').hidden = false;
  const { clinics } = await r.json();
  // Bir xil kompyuter kodi bir nechta yozuvda — takror o'rnatish yoki kimdir kodni bilib soxta yozuv ochgan
  const seen = {};
  for (const c of clinics) if (c.machineId) seen[c.machineId] = (seen[c.machineId] || 0) + 1;
  names = Object.fromEntries(clinics.map(c => [c.id, c.name]));
  $('list').replaceChildren(...clinics.map(c => row(c, c.machineId ? seen[c.machineId] : 1)));
  say(clinics.length ? '' : "Hali klinika yo'q");
}

function row(c, twins) {
  const li = el('li');
  const dot = el('span', 'dot' + (c.online ? ' on' : ''));
  dot.title = c.online ? 'aloqada' : 'aloqada emas';
  const who = el('div', 'who');
  const lic = c.status && c.status.license;
  const licText = !lic ? '' : lic.activated ? ' · litsenziya bor' : ' · litsenziyasiz (' + lic.daysLeft + ' kun qoldi)';
  // O'zi ulangan kompyuter: nomi — kompyuter nomi, yonida ulash ustasida yozilgan klinika nomi
  const label = c.status && c.status.label ? ' — ' + c.status.label : '';
  const setup = !!(c.status && c.status.setup);
  const fresh = (c.approved ? '' : 'tasdiqlanmagan · ') + (setup ? 'sozlanmoqda (egasiga topshirilmagan) · ' : '');
  const twin = twins > 1 ? ' · ⚠ bu kod ' + twins + ' ta yozuvda' : '';
  who.append(el('b', '', c.name + label), el('small', '', fresh + (c.online ? 'aloqada' : 'aloqada emas · ' + ago(c.seenAt)) + (c.status && c.status.version ? ' · v' + c.status.version : '') + licText + (c.machineId ? ' · ' + c.machineId : '') + twin));
  li.append(dot, who);
  if (!c.approved) {
    // Tasdiqlash va o'chirish — faqat asoschi (o'rnatuvchi ko'radi, lekin qila olmaydi). Yangi o'rnatish kalitsiz ochilmaydi —
    // shuning uchun tasdiqlash o'sha bosishda litsenziyani ham beradi (bitta kod, bitta tugma)
    if (!founder()) return li;
    const ok = el('button', '', lic && lic.activated ? 'Tasdiqlash' : 'Tasdiqlash va aktivlashtirish');
    ok.onclick = () => approve(c, ok);
    const del = el('button', 'second', "O'chirish");
    del.onclick = () => remove(c, del);
    li.append(ok, del);
    return li;
  }
  const btn = el('button', '', setup ? 'Sozlash' : 'Panelni ochish');
  btn.disabled = !c.online;
  btn.onclick = () => enter(c, li, btn, undefined, setup);
  if (lic && !lic.activated && founder()) {
    const act = el('button', 'second', 'Aktivlashtirish');
    act.disabled = !c.online;
    act.onclick = () => license(c, act);
    li.append(act);
  }
  li.append(btn);
  return li;
}

async function approve(c, btn) {
  const code = prompt("«" + c.name + "»: o'rnatuvchidan (yoki egasidan) ekrandagi kompyuter kodini so'rang va kiriting — XXXX-XXXX-XXXX-XXXX:");
  if (!code) return;
  btn.disabled = true;
  try {
    const r = await api('/admin/clinics/' + c.id + '/approve', { machineId: code.trim() });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    if (!r.ok) return say(j.error || 'Xato: ' + r.status);
    // Holat hali kelmagan (endigina ulangan) bo'lsa ham urinib ko'riladi: litsenziyani klinikaning o'zidan so'raydi
    const lic = c.status && c.status.license;
    if (lic && lic.activated) { say('«' + c.name + '» tasdiqlandi'); return load(); }
    // Tasdiqlandi — endi o'sha kod bilan litsenziya (klinika ekranidagi aktivlashtirish oynasi o'zi yopiladi)
    say('«' + c.name + "» tasdiqlandi, litsenziya berilmoqda…");
    const g = await api('/admin/clinics/' + c.id + '/license', {});
    const gj = await g.json().catch(() => ({}));
    say(g.ok ? '«' + c.name + "» tasdiqlandi va aktivlashtirildi — klinika ekrani o'zi ochiladi" : '«' + c.name + "» tasdiqlandi, lekin litsenziya berilmadi: " + (gj.error || 'Xato: ' + g.status) + " — «Aktivlashtirish»ni qayta bosing");
    load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function remove(c, btn) {
  if (!confirm("«" + c.name + "» yozuvi o'chirilsinmi? (tasdiqlanmagan — soxta yoki takror yozuv)")) return;
  btn.disabled = true;
  try {
    const r = await api('/admin/clinics/' + c.id + '/delete', {});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    say(r.ok ? "O'chirildi" : (j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function license(c, btn) {
  btn.disabled = true;
  say('«' + c.name + "» uchun litsenziya berilmoqda…");
  try {
    const r = await api('/admin/clinics/' + c.id + '/license', {});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    say(r.ok ? '«' + c.name + '» aktivlashtirildi' : (j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function enter(c, li, btn, business, setup) {
  // Oyna bosish paytida ochiladi (javobdan keyin ochilsa brauzer to'sib qo'yadi); panel bu sahifaga qaytib murojaat qila olmasin
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  btn.disabled = true;
  say(setup ? '«' + c.name + '» paneli ochilmoqda…' : '«' + c.name + "» egasidan ruxsat so'ralmoqda (Telegram'da, 2 daqiqagacha)…");
  try {
    const r = await api('/admin/clinics/' + c.id + '/panel', business ? { business } : {});
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.token) {
      // Sozlanayotgan klinika — to'g'ri ulash ustasiga (src/lib/telegramLaunch.ts: kalitdan keyin #/ulash)
      if (tab) tab.location.href = '/c/' + c.id + '/#kirish=' + encodeURIComponent(j.token) + (setup ? '&ulash' : '');
      return say('');
    }
    if (tab) tab.close();
    if (r.status === 401) return load();
    if (r.status === 409 && Array.isArray(j.businesses)) return choose(c, li, btn, j.businesses);
    say(j.error || 'Xato: ' + r.status);
  } catch {
    if (tab) tab.close();
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

function choose(c, li, btn, list) {
  li.querySelector('.pick')?.remove();
  const box = el('div', 'pick');
  for (const b of list) {
    const x = el('button', '', b.name);
    x.onclick = () => { box.remove(); enter(c, li, btn, b.id); };
    box.append(x);
  }
  li.append(box);
  say('Bu kompyuterda bir nechta biznes — qaysi biri?');
}

// Yangi klinika: kod faqat shu javobda keladi — hubda saqlanmaydi, yo'qolsa yangi yozuv ochiladi
$('new').onsubmit = async e => {
  e.preventDefault();
  const name = $('nm').value.trim();
  if (!name) return;
  const b = $('new').querySelector('button');
  b.disabled = true;
  try {
    const r = await api('/admin/clinics', { name });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    if (!r.ok || !j.code) return say(j.error || 'Xato: ' + r.status);
    $('nm').value = '';
    showCode(name, j.code);
    load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    b.disabled = false;
  }
};

function showCode(name, code) {
  const box = $('code');
  const copy = el('button', '', 'Nusxalash');
  copy.type = 'button';
  copy.onclick = () => navigator.clipboard.writeText(code).then(() => { copy.textContent = 'Nusxalandi'; }, () => { copy.textContent = 'Kodni belgilab nusxalang'; });
  box.replaceChildren(
    el('b', '', '«' + name + '» ulanish kodi'),
    el('code', '', code),
    el('small', '', "O'rnatuvchiga bering: ulash ustasi → «Kalitlar» maydoniga qo'yadi. Faqat kompyuter Hub'ga o'zi ulana olmaganda kerak. Kod faqat hozir ko'rinadi — saqlab qo'ying."),
    copy,
  );
  box.hidden = false;
}

function signedOut() {
  store.set(null);
  me = null;
  for (const id of ['new', 'code', 'bar', 'pwf', 'team', 'audit']) $(id).hidden = true;
  $('list').replaceChildren();
  $('key').hidden = false;
}

// Kirish: login bo'sh — parol maydonidagi asosiy kalit (HUB_ADMIN_KEY); aks holda shaxsiy hisob
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
      store.set(j.token);
    } else store.set(secret.trim());
    const r = await api('/admin/me');
    if (!r.ok) { signedOut(); return say(login ? 'Kirib bo\\'lmadi' : "Asosiy kalit noto'g'ri"); }
    me = (await r.json()).member;
    $('me').replaceChildren(el('b', '', me.name), document.createTextNode(' · ' + (ROLE[me.role] || me.role)));
    $('tabTeam').hidden = $('tabAudit').hidden = !founder();
    // Asosiy kalitning paroli yo'q (u Hub sozlamasida)
    $('pw').hidden = me.id === 'kalit';
    $('key').hidden = true;
    $('bar').hidden = false;
    say('');
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
  if (r && r.ok && j.token) { store.set(j.token); $('pwf').hidden = true; return say("Parol almashdi — boshqa qurilmalardagi kirishlar tugadi"); }
  say(j.error || "Hub bilan aloqa yo'q");
};

// ─── Jamoa (faqat asoschi) ───
$('tabTeam').onclick = () => { $('team').hidden = !$('team').hidden; if (!$('team').hidden) members(); };
async function members() {
  const r = await api('/admin/team').catch(() => null);
  if (!r || !r.ok) return say(r && r.status === 401 ? 'Qayta kiring' : 'Jamoani olib bo\\'lmadi');
  const { team } = await r.json();
  $('members').replaceChildren(...team.map(m => {
    const li = el('li', m.active ? '' : 'off');
    const who = el('div', 'who');
    who.append(el('b', '', m.name), el('small', '', m.login + ' · ' + (ROLE[m.role] || m.role) + (m.active ? '' : ' · yopiq') + ' · oxirgi kirish: ' + (m.seenAt ? ago(m.seenAt) : "hali yo'q")));
    const reset = el('button', 'second mini', 'Yangi parol');
    reset.onclick = async () => {
      if (!confirm('«' + m.name + "» uchun yangi parol? Eski parol va ochiq kirishlari bekor bo'ladi.")) return;
      const x = await api('/admin/team/' + m.id + '/reset', {});
      const j = await x.json().catch(() => ({}));
      if (x.ok && j.password) showSecret($('mcode'), '«' + m.name + '» — yangi parol', 'login: ' + m.login + ' · parol: ' + j.password);
      else say(j.error || 'Xato: ' + x.status);
    };
    const flip = el('button', 'second mini', m.active ? 'Yopish' : 'Ochish');
    flip.onclick = async () => {
      const x = await api('/admin/team/' + m.id + '/' + (m.active ? 'off' : 'on'), {});
      const j = await x.json().catch(() => ({}));
      if (!x.ok) say(j.error || 'Xato: ' + x.status);
      members();
    };
    li.append(who);
    if (m.id !== me.id) li.append(reset, flip);
    return li;
  }));
}
$('addm').onsubmit = async e => {
  e.preventDefault();
  const r = await api('/admin/team', { name: $('mn').value.trim(), login: $('ml').value.trim().toLowerCase(), role: $('mr').value }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !j.password) return say(j.error || "Hub bilan aloqa yo'q");
  showSecret($('mcode'), '«' + j.member.name + "» qo'shildi", 'login: ' + j.member.login + ' · parol: ' + j.password);
  $('mn').value = $('ml').value = '';
  members();
};

// ─── Jurnal (faqat asoschi) ───
const ACTION = {
  'kirish': 'Hubga kirdi', 'klinika.yaratildi': 'yangi klinika ochdi', 'panel.ochildi': 'klinika paneliga kirdi', 'panel.rad': 'panelga kirolmadi',
  'panel.javobsiz': 'panelga kirolmadi (klinika javob bermadi)', 'litsenziya.berildi': 'litsenziya berdi', 'klinika.tasdiqlandi': 'kompyuterni tasdiqladi',
  'klinika.ochirildi': "yozuvni o'chirdi", 'zaxira.yuklandi': 'zaxirani yukladi', 'diagnostika.oqildi': "diagnostikani o'qidi",
  'jamoa.qoshildi': "jamoaga qo'shdi", 'jamoa.parol': 'yangi parol berdi', 'jamoa.yopildi': 'hisobni yopdi', 'jamoa.ochildi': 'hisobni ochdi', 'parol.almashdi': "o'z parolini almashtirdi",
};
let names = {};
$('tabAudit').onclick = () => { $('audit').hidden = !$('audit').hidden; if (!$('audit').hidden) audit(); };
async function audit() {
  const r = await api('/admin/audit').catch(() => null);
  if (!r || !r.ok) return say('Jurnalni olib bo\\'lmadi');
  const { audit } = await r.json();
  $('log').replaceChildren(...audit.map(a => {
    const li = el('li');
    const clinic = a.clinicId ? ' — ' + (names[a.clinicId] || a.clinicId) : '';
    li.append(el('b', '', a.actor), document.createTextNode(' ' + (ACTION[a.action] || a.action) + clinic + (a.detail ? ' (' + a.detail + ')' : '') + ' '), el('small', '', new Date(a.at).toLocaleString()));
    return li;
  }));
  if (!audit.length) $('log').replaceChildren(el('li', '', "Hali yozuv yo'q"));
}

function showSecret(box, title, line) {
  const copy = el('button', '', 'Nusxalash');
  copy.type = 'button';
  copy.onclick = () => navigator.clipboard.writeText(line).then(() => { copy.textContent = 'Nusxalandi'; }, () => { copy.textContent = 'Belgilab nusxalang'; });
  box.replaceChildren(el('b', '', title), el('code', '', line), el('small', '', "Faqat hozir ko'rinadi — o'ziga bering; kirgach «Parolim» bilan almashtiradi."), copy);
  box.hidden = false;
}

$('key').hidden = false;
setInterval(() => { if (store.get() && document.visibilityState === 'visible' && !document.querySelector('.pick')) load(); }, 30000);
</script>`;
}
