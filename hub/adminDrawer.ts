/**
 * Boshqaruv markazi (/admin) — mijoz oynasi (holat, muammolar, karta, amallar, yordam so'rovlari), «Yordam», «Jamoa», «Jurnal»,
 * yangi mijoz va o'zim o'rnatgan kompyuterni biriktirish. adminApp.ts dan keyin bitta <script> da ishlaydi (uning yordamchilari bilan).
 *
 * Amallar avvalgidek: panel oynasi bosish paytida ochiladi va ochuvchisiz (opener = null) — panel bu sahifaga qo'l cho'za olmaydi;
 * tasdiqlash kompyuter kodi bilan va o'sha bosishda litsenziya; kirishni tiklash — egasining shaxsi tekshirilgandan keyin.
 */
export const ADMIN_DRAWER_JS = String.raw`
let openId = null;
const clientById = id => data.clinics.find(c => c.id === id) || null;

function openClient(id) {
  openId = id;
  $('dSecret').hidden = true;
  $('scrim').hidden = $('drawer').hidden = false;
  drawClient(true);
  $('drawerClose').focus();
}
function closeClient() {
  openId = null;
  $('scrim').hidden = $('drawer').hidden = true;
}
$('scrim').onclick = closeClient;
$('drawerClose').onclick = closeClient;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && openId) closeClient(); });
/** Ro'yxat yangilanganda: karta yozilayotgan bo'lsa yoki tanlov ochiq — oyna qayta chizilmaydi (yozilgan matn yo'qolmasin) */
function refreshDrawer() {
  if (!openId) return;
  if (!clientById(openId)) return closeClient();
  const d = $('drawer');
  if (d.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (d.querySelector('.pick') || d.dataset.dirty === '1') return;
  drawClient(false);
}

function fact(dl, label, value) { if (value === null || value === undefined || value === '') return; dl.append(el('dt', '', label), el('dd', '', value)); }
function sect(title) { const s = el('section', 'card sect'); s.append(el('h3', '', title)); return s; }

function drawClient(scrollTop) {
  const c = clientById(openId);
  if (!c) return;
  const s = c.status || {}, card = c.card || {}, st = stateOf(c);
  $('dTitle').textContent = titleOf(c);
  const pill = el('span', 'pill ' + { on: 'ok', off: 'bad', bad: 'bad', new: 'warn' }[st], { on: 'aloqada', off: "aloqa yo'q", bad: 'muammo bor', new: c.approved ? 'sozlanmoqda' : 'tasdiqlanmagan' }[st]);
  $('dSub').replaceChildren(pill, document.createTextNode(' ' + [KIND[kindOf(c)], card.city, c.online ? null : ago(c.seenAt)].filter(Boolean).join(' · ')));
  const body = $('dBody');
  const parts = [actionsOf(c)];
  const al = alertsOf(c);
  if (al.length) {
    const box = sect('Diqqat'), ul = el('ul', 'issues');
    for (const a of al.sort((p, q) => RANK[p.level] - RANK[q.level])) { const li = el('li'); li.append(el('span', 'lvl ' + a.level), el('span', '', a.text)); ul.append(li); }
    box.append(ul);
    parts.push(box);
  }
  const info = sect('Holat'), dl = el('dl', 'facts');
  fact(dl, 'Aloqa', c.online ? 'aloqada (' + ago(c.seenAt) + ')' : ago(c.seenAt));
  fact(dl, 'Nashr', s.version ? 'v' + s.version + (s.schema ? ' · baza ' + s.schema : '') : null);
  fact(dl, 'Ishlayapti', s.startedAt ? ago(s.startedAt).replace(' oldin', 'dan beri') : null);
  fact(dl, 'Bizneslar', s.label ? s.label + (s.industries && s.industries.length ? ' (' + s.industries.join(', ') + ')' : '') : null);
  fact(dl, 'Disk', typeof s.diskFreeMb === 'number' ? (s.diskFreeMb / 1024).toFixed(1) + ' GB bo\'sh' : null);
  fact(dl, 'Litsenziya', s.license ? (s.license.activated ? 'aktivlashtirilgan' : 'yo\'q — ' + s.license.daysLeft + ' kun qoldi') : null);
  fact(dl, 'Tashqi zaxira', s.lastOffsite ? (s.lastOffsite.ok ? 'yuborildi ' + (s.lastOffsite.day || '') : 'yuborilmadi: ' + (s.lastOffsite.error || '')) : null);
  fact(dl, 'Yangilanish', s.lastUpdate ? (s.lastUpdate.to ? 'v' + s.lastUpdate.to + ' — ' : '') + s.lastUpdate.result + (s.lastUpdate.at ? ' · ' + ago(s.lastUpdate.at) : '') : null);
  fact(dl, 'Kompyuter kodi', c.machineId);
  fact(dl, "Hub'da", dateText(c.createdAt) + (c.self ? " · o'zi ulangan" : ''));
  info.append(dl);
  parts.push(info, cardForm(c));
  const asks = helpRows.filter(h => h.clinicId === c.id);
  if (asks.length) { const box = sect("Yordam so'rovlari"), ul = el('ul', 'list'); ul.append(...asks.map(askRow)); box.append(ul); parts.push(box); }
  body.replaceChildren(...parts);
  $('drawer').dataset.dirty = '0';
  if (scrollTop) body.scrollTop = 0;
}

// ─── Mijoz kartasi (asoschi yozadi, o'rnatuvchi ko'radi) ───
function cardForm(c) {
  const card = c.card || {}, box = sect('Mijoz kartasi'), f = el('form', 'form');
  const field = (label, input, wide) => { const l = el('label', 'f' + (wide ? ' wide' : ''), label); l.append(input); f.append(l); return input; };
  const input = (name, value, attrs) => { const i = el('input'); i.name = name; i.value = value === null || value === undefined ? '' : value; for (const k in attrs || {}) i.setAttribute(k, attrs[k]); return i; };
  field('Egasi', input('owner', card.owner, { maxlength: 80, placeholder: 'Ismi' }));
  field('Telefon', input('phone', card.phone, { maxlength: 24, placeholder: '+998 90 123 45 67', inputmode: 'tel' }));
  field('Shahar', input('city', card.city, { maxlength: 80, placeholder: 'Toshkent' }));
  const kind = el('select');
  kind.name = 'kind';
  const auto = el('option', '', 'Avtomatik' + (c.status && c.status.kinds && c.status.kinds[0] ? ' — ' + KIND[c.status.kinds[0]] : ''));
  auto.value = '';
  kind.append(auto, ...KIND_ORDER.map(k => { const o = el('option', '', KIND[k]); o.value = k; return o; }));
  kind.value = card.kind || '';
  field('Biznes turi', kind);
  field("Oylik tarif (so'm)", input('plan', card.plan, { inputmode: 'numeric', placeholder: '500 000' }));
  field("To'langan sana (qachongacha)", input('paidUntil', card.paidUntil, { type: 'date' }));
  const note = el('textarea');
  note.name = 'note';
  note.maxLength = 1000;
  note.placeholder = "Izoh: kelishuvlar, nima va'da qilingan, kim tanishtirgan…";
  note.value = card.note || '';
  field('Izoh', note, true);
  const foot = el('div', 'row wide');
  if (founder()) {
    const save = el('button', 'btn', 'Saqlash');
    foot.append(save);
  } else for (const x of f.querySelectorAll('input,select,textarea')) x.disabled = true;
  if (card.updatedAt) foot.append(el('small', 'meta', "O'zgartirdi: " + (card.updatedBy || '—') + ' · ' + ago(card.updatedAt)));
  f.append(foot);
  f.oninput = () => { $('drawer').dataset.dirty = '1'; };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    const v = Object.fromEntries(new FormData(f));
    try {
      const r = await api('/admin/clinics/' + c.id + '/card', v);
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) return load();
      if (!r.ok) return say(j.error || 'Xato: ' + r.status);
      c.card = j.card;
      $('drawer').dataset.dirty = '0';
      say('Karta saqlandi');
      render();
      drawClient(false);
    } catch {
      say("Hub bilan aloqa yo'q");
    } finally {
      btn.disabled = false;
    }
  };
  box.append(f);
  return box;
}

// ─── Amallar ───
function actionsOf(c) {
  const box = el('div', 'actions'), lic = c.status && c.status.license, setup = !!(c.status && c.status.setup);
  const add = (label, cls, fn, needOnline) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; if (needOnline) b.disabled = !c.online; b.onclick = () => fn(c, b, box); box.append(b); return b; };
  if (!c.approved) {
    // Tasdiqlash va o'chirish — faqat asoschi. Yangi o'rnatish kalitsiz ochilmaydi: tasdiqlash o'sha bosishda litsenziyani ham beradi
    if (!founder()) { box.append(el('small', 'meta', 'Asoschi tasdiqlaguncha panel va litsenziya yopiq')); return box; }
    add(lic && lic.activated ? 'Tasdiqlash' : 'Tasdiqlash va aktivlashtirish', '', approve);
    add("O'chirish", 'danger', remove);
    return box;
  }
  add(setup ? 'Sozlash' : 'Panelni ochish', '', (cl, b, bx) => enter(cl, bx, b, undefined, setup), true);
  if (lic && !lic.activated && founder()) {
    add('Aktivlashtirish', 'ghost', license, true);
    // Windows qayta o'rnatildi yoki kompyuter almashdi — kod o'zgaradi, «Aktivlashtirish» 409 beradi
    add('Kompyuter almashdi', 'ghost', rebind, true);
  }
  // Egasi Telegram'ini ham, parolini ham yo'qotgan — kirishni tiklash (faqat asoschi, egasining shaxsi tekshirilgandan keyin)
  if (founder() && !setup) add('Kirishni tiklash', 'ghost', recover, true);
  return box;
}

async function call(path, body) {
  const r = await api(path, body);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { load(); return null; }
  return { ok: r.ok, status: r.status, j };
}
async function guarded(btn, work) {
  btn.disabled = true;
  try { await work(); } catch { say("Hub bilan aloqa yo'q"); } finally { btn.disabled = false; }
}

function approve(c, btn) {
  const code = prompt('«' + c.name + "»: o'rnatuvchidan (yoki egasidan) ekrandagi kompyuter kodini so'rang va kiriting — XXXX-XXXX-XXXX-XXXX:");
  if (!code) return;
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/approve', { machineId: code.trim() });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    const lic = c.status && c.status.license;
    if (lic && lic.activated) { say('«' + c.name + '» tasdiqlandi'); return load(); }
    say('«' + c.name + '» tasdiqlandi, litsenziya berilmoqda…');
    const g = await call('/admin/clinics/' + c.id + '/license', {});
    if (!g) return;
    say(g.ok ? '«' + c.name + "» tasdiqlandi va aktivlashtirildi — klinika ekrani o'zi ochiladi" : '«' + c.name + '» tasdiqlandi, lekin litsenziya berilmadi: ' + (g.j.error || 'Xato: ' + g.status) + ' — «Aktivlashtirish»ni qayta bosing');
    load();
  });
}

function remove(c, btn) {
  if (!confirm('«' + c.name + "» yozuvi o'chirilsinmi? (tasdiqlanmagan — soxta yoki takror yozuv)")) return;
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/delete', {});
    if (!r) return;
    say(r.ok ? "O'chirildi" : (r.j.error || 'Xato: ' + r.status));
    if (r.ok) { closeClient(); load(); }
  });
}

function recover(c, btn) {
  if (!confirm('«' + c.name + "»: egasining kirishini tiklaysizmi?\n\nFaqat egasining shaxsini tekshirgandan keyin (pasport, klinika hujjati, tanish ovoz). Yangi parol beriladi, eski kirishlar yopiladi, eski Telegram uziladi va unga aytiladi.")) return;
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/recover', {});
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    showSecret($('dSecret'), '«' + c.name + '» — yangi kirish (faqat egasiga bering)', 'login: ' + r.j.login + ' · parol: ' + r.j.password, "Egasi kirgach Sozlamalar → Telegram'dan qayta ulanadi.");
  });
}

function rebind(c, btn) {
  const code = prompt('«' + c.name + "»: kompyuter almashdi — egasidan yangi kompyuter ekranidagi kodni so'rang va kiriting (XXXX-XXXX-XXXX-XXXX):");
  if (!code) return;
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/machine', { machineId: code.trim() });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    say('«' + c.name + '»: yangi kompyuter kodi yozildi, litsenziya berilmoqda…');
    const g = await call('/admin/clinics/' + c.id + '/license', {});
    if (!g) return;
    say(g.ok ? '«' + c.name + '» yangi kompyuterda aktivlashtirildi' : 'Kod yozildi, lekin litsenziya berilmadi: ' + (g.j.error || 'Xato: ' + g.status) + ' — «Aktivlashtirish»ni qayta bosing');
    load();
  });
}

function license(c, btn) {
  say('«' + c.name + '» uchun litsenziya berilmoqda…');
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/license', {});
    if (!r) return;
    say(r.ok ? '«' + c.name + '» aktivlashtirildi' : (r.j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  });
}

async function enter(c, box, btn, business, setup) {
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
    if (r.status === 409 && Array.isArray(j.businesses)) return choose(c, box, btn, j.businesses);
    say(j.error || 'Xato: ' + r.status);
  } catch {
    if (tab) tab.close();
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

function choose(c, box, btn, list) {
  box.querySelector('.pick')?.remove();
  const pick = el('div', 'pick');
  for (const b of list) {
    const x = el('button', 'btn ghost sm', b.name);
    x.type = 'button';
    x.onclick = () => { pick.remove(); enter(c, box, btn, b.id); };
    pick.append(x);
  }
  box.append(pick);
  say('Bu kompyuterda bir nechta biznes — qaysi biri?');
}

// ─── Yordam so'rovlari ───
function renderHelp() {
  const open = helpRows.filter(h => !h.answer).length;
  $('helpSub').textContent = helpRows.length ? (open ? open + ' ta javob kutyapti' : 'hammasiga javob berilgan') : '';
  $('helpList').replaceChildren(...(helpRows.length ? helpRows.map(askRow) : [el('li', 'card empty', "Hali so'rov yo'q — egasi panelda yoki botda /yordam bilan yozsa, shu yerga tushadi")]));
}
/** Javob yozilayotgan yoki diagnostika ochiq bo'lsa — ro'yxat o'z-o'zidan yangilanmaydi (yozilgan matn yo'qolmasin) */
const busyWithHelp = () => [...document.querySelectorAll('#helpList textarea')].some(t => t.value.trim() || t === document.activeElement) || !!document.querySelector('#helpList pre');

function askRow(h) {
  const li = el('li', 'card item');
  const where = h.clinicName + (h.businessName && h.businessName !== h.clinicName ? ' (' + h.businessName + ')' : '');
  const head = el('div', 'row');
  const name = el('b', '', where);
  head.append(name, el('span', 'meta', (h.by ? h.by + ' · ' : '') + ago(h.createdAt) + (h.diag ? ' · diagnostika bilan' : '')));
  if (!h.answer) head.append(el('span', 'pill bad', 'javobsiz'));
  li.append(head, el('p', '', h.text));
  const tools = el('div', 'row');
  if (h.diag) {
    const show = el('button', 'btn ghost sm', 'Diagnostika');
    show.type = 'button';
    show.onclick = async () => {
      const shown = li.querySelector('pre');
      if (shown) return shown.remove();
      const x = await api('/admin/diag/' + h.clinicId + '/' + h.diag).catch(() => null);
      tools.after(el('pre', '', x && x.ok ? await x.text() : "Diagnostikani o'qib bo'lmadi"));
    };
    tools.append(show);
  }
  if (view === 'help' && clientById(h.clinicId)) {
    const go = el('button', 'btn ghost sm', 'Mijoz kartasi');
    go.type = 'button';
    go.onclick = () => openClient(h.clinicId);
    tools.append(go);
  }
  li.append(tools);
  if (h.answer) {
    const a = el('div', 'ans');
    a.append(el('span', 'meta', 'Javob' + (h.answeredBy ? ' — ' + h.answeredBy : '') + ' · ' + ago(h.answeredAt)), el('p', '', h.answer));
    // Klinika 3 kundan ko'p o'chiq turgan bo'lsa navbatdagi javob o'chadi — qayta yuboriladi (yetib borgani takrorlanmaydi)
    const again = el('button', 'btn ghost sm', 'Qayta yuborish');
    again.type = 'button';
    again.title = "Egasi javobni olmagan bo'lsa (klinika kompyuteri uzoq o'chiq turgan)";
    again.onclick = () => guarded(again, async () => {
      const r = await call('/admin/help/' + h.id + '/resend', {});
      if (r) say(r.ok ? 'Qayta yuborildi — klinika kompyuteri yonganda egasiga yetadi' : (r.j.error || 'Xato: ' + r.status));
    });
    li.append(a, again);
    return li;
  }
  const text = el('textarea');
  text.placeholder = 'Javob — egasining Telegramiga va paneliga boradi';
  text.maxLength = 2000;
  text.setAttribute('aria-label', 'Javob: ' + where);
  const send = el('button', 'btn', 'Javob yuborish');
  send.type = 'button';
  send.onclick = () => {
    const answer = text.value.trim();
    if (!answer) return text.focus();
    return guarded(send, async () => {
      const r = await call('/admin/help/' + h.id + '/answer', { text: answer });
      if (!r) return;
      // Boshqa jamoa a'zosi javob bergan (409) yoki so'rov yo'q (404) — ro'yxat yangilanadi, eski forma qolib ketmasin
      if (r.status === 404 || r.status === 409) { text.value = ''; say(r.j.error || 'Xato: ' + r.status); return load(); }
      if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
      say('Javob yuborildi — egasining Telegramiga boradi');
      text.value = '';
      load();
    });
  };
  li.append(text, send);
  return li;
}

// ─── Yangi mijoz va biriktirish ───
// Kompyuter o'zi ulana olmasa — yozuv tasdiqlangan holda ochiladi; kod faqat shu javobda keladi (hubda faqat xeshi)
$('new').onsubmit = async e => {
  e.preventDefault();
  const name = $('nm').value.trim();
  if (!name) return;
  const b = $('new').querySelector('button');
  await guarded(b, async () => {
    const r = await call('/admin/clinics', { name });
    if (!r) return;
    if (!r.ok || !r.j.code) return say(r.j.error || 'Xato: ' + r.status);
    $('nm').value = '';
    showSecret($('code'), '«' + name + '» ulanish kodi', r.j.code, "O'rnatuvchiga bering: ulash ustasi → «Kalitlar» maydoniga qo'yadi. Faqat kompyuter Hub'ga o'zi ulana olmaganda kerak. Kod faqat hozir ko'rinadi — saqlab qo'ying.");
    load();
  });
};
// O'rnatuvchi: o'zi o'rnatgan kompyuterni ekrandagi kod bilan biriktiradi — asoschi tasdiqlagach panel va litsenziya ochiladi
$('claim').onsubmit = async e => {
  e.preventDefault();
  const machineId = $('cm').value.trim();
  if (!machineId) return;
  const b = $('claim').querySelector('button');
  await guarded(b, async () => {
    const r = await call('/admin/claim', { machineId });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    $('cm').value = '';
    say("Biriktirildi — kompyuter ro'yxatingizda. Asoschi tasdiqlagach panel va litsenziya ochiladi.");
    load();
  });
};

function showSecret(box, title, line, note) {
  const copy = el('button', 'btn sm', 'Nusxalash');
  copy.type = 'button';
  copy.onclick = () => navigator.clipboard.writeText(line).then(() => { copy.textContent = 'Nusxalandi'; }, () => { copy.textContent = 'Belgilab nusxalang'; });
  box.replaceChildren(el('b', '', title), el('code', '', line), el('small', '', note || "Faqat hozir ko'rinadi — o'ziga bering; kirgach parolini almashtiradi."), copy);
  box.hidden = false;
}

// ─── Jamoa (faqat asoschi) ───
async function members() {
  const r = await api('/admin/team').catch(() => null);
  if (!r || !r.ok) return say(r && r.status === 401 ? 'Qayta kiring' : "Jamoani olib bo'lmadi");
  const { team } = await r.json();
  $('members').replaceChildren(...team.map(m => {
    const li = el('li', 'card item' + (m.active ? '' : ' dim'));
    const head = el('div', 'row');
    head.append(el('b', '', m.name), el('span', 'pill', ROLE[m.role] || m.role), el('span', 'meta', m.login + (m.active ? '' : ' · yopiq') + ' · oxirgi kirish: ' + (m.seenAt ? ago(m.seenAt) : "hali yo'q")));
    li.append(head);
    if (m.id === me.id) return li;
    const tools = el('div', 'row');
    tools.style.marginTop = '10px';
    const reset = el('button', 'btn ghost sm', 'Yangi parol');
    reset.onclick = async () => {
      if (!confirm('«' + m.name + "» uchun yangi parol? Eski parol va ochiq kirishlari bekor bo'ladi.")) return;
      const x = await call('/admin/team/' + m.id + '/reset', {});
      if (x && x.ok && x.j.password) showSecret($('mcode'), '«' + m.name + '» — yangi parol', 'login: ' + m.login + ' · parol: ' + x.j.password);
      else if (x) say(x.j.error || 'Xato: ' + x.status);
    };
    const flip = el('button', 'btn ghost sm', m.active ? 'Yopish' : 'Ochish');
    flip.onclick = async () => {
      const x = await call('/admin/team/' + m.id + '/' + (m.active ? 'off' : 'on'), {});
      if (x && !x.ok) say(x.j.error || 'Xato: ' + x.status);
      members();
    };
    tools.append(reset, flip);
    li.append(tools);
    return li;
  }));
}
$('addm').onsubmit = async e => {
  e.preventDefault();
  const r = await call('/admin/team', { name: $('mn').value.trim(), login: $('ml').value.trim().toLowerCase(), role: $('mr').value }).catch(() => null);
  if (!r || !r.ok || !r.j.password) return say((r && r.j.error) || "Hub bilan aloqa yo'q");
  showSecret($('mcode'), '«' + r.j.member.name + "» qo'shildi", 'login: ' + r.j.member.login + ' · parol: ' + r.j.password);
  $('mn').value = $('ml').value = '';
  members();
};

// ─── Jurnal (faqat asoschi) ───
const ACTION = {
  'kirish': 'Hubga kirdi', 'klinika.yaratildi': 'yangi mijoz ochdi', 'panel.ochildi': 'paneliga kirdi', 'panel.rad': 'panelga kirolmadi',
  'panel.javobsiz': 'panelga kirolmadi (mijoz javob bermadi)', 'litsenziya.berildi': 'litsenziya berdi', 'klinika.tasdiqlandi': 'kompyuterni tasdiqladi',
  'klinika.ochirildi': "yozuvni o'chirdi", 'zaxira.yuklandi': 'zaxirani yukladi', 'diagnostika.oqildi': "diagnostikani o'qidi", 'yordam.javob': "yordam so'roviga javob berdi", 'yordam.qayta': 'javobni qayta yubordi',
  'jamoa.qoshildi': "jamoaga qo'shdi", 'jamoa.parol': 'yangi parol berdi', 'jamoa.yopildi': 'hisobni yopdi', 'jamoa.ochildi': 'hisobni ochdi', 'parol.almashdi': "o'z parolini almashtirdi",
  'kirish.tiklandi': 'egasining kirishini tikladi', 'kirish.tiklanmadi': 'kirishni tiklay olmadi', 'klinika.kompyuter_almashdi': 'kompyuter kodini yangiladi', 'klinika.biriktirildi': "o'zi o'rnatgan kompyuterni biriktirdi",
  'karta.yangilandi': 'mijoz kartasini yangiladi',
};
async function audit() {
  const r = await api('/admin/audit').catch(() => null);
  if (!r || !r.ok) return say("Jurnalni olib bo'lmadi");
  const { audit } = await r.json();
  const names = Object.fromEntries(data.clinics.map(c => [c.id, c.name]));
  $('log').replaceChildren(...(audit.length ? audit.map(a => {
    const li = el('li'), t = el('time', 'num', new Date(a.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    const what = el('span');
    what.append(el('b', '', a.actor), document.createTextNode(' ' + (ACTION[a.action] || a.action) + (a.clinicId ? ' — ' + (names[a.clinicId] || a.clinicId) : '') + (a.detail ? ' (' + a.detail + ')' : '')));
    li.append(t, what);
    return li;
  }) : [el('li', 'empty', "Hali yozuv yo'q")]));
}

setInterval(() => { if (adminKey && document.visibilityState === 'visible' && (view === 'overview' || view === 'clients' || view === 'help')) load(); }, 30000);
`;
