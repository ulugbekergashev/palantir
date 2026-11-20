/**
 * Boshqaruv markazi — tezkor oyna (Mijozlar jadvalidagi «⋯» va mijoz sahifasidagi «Tezkor amallar»): sahifaga kirmasdan eng ko'p
 * kerak bo'ladigan uch ish — to'lamagan mijozni to'xtatish, to'lagach yoqish (to'langan sana bir oyga suriladi) va butunlay o'chirish.
 * Muddatli to'xtatish yo'q (egasi qarori): to'xtatilgan mijoz pul to'laguncha to'xtab turadi, yoqish — qo'lda.
 * Hammasi mavjud yo'llar orqali: POST /admin/clinics/<id>/access, /card, /delete (hub/server.ts 14–15-band) — server tekshiruvi
 * o'zgarmaydi (asoschi, tasdiqlangan mijozni o'chirishda nomi aynan). adminDrawer.ts dan keyin o'sha <script> da ishlaydi.
 */
export const ADMIN_QUICK_JS = String.raw`
const STOP_TEXT = "To'lov qilinmagani uchun Palantir vaqtincha to'xtatildi. To'lovdan keyin darhol yoqiladi.";
let quickId = null;

/** Mahalliy bugungi sana (YYYY-MM-DD) va bir oy keyingisi: 31-yanvar → 28/29-fevral */
const todayDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function plusMonth(day) {
  const d = new Date(day + 'T12:00:00Z'), m = d.getUTCMonth();
  d.setUTCMonth(m + 1);
  if (d.getUTCMonth() !== (m + 1) % 12) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
/** To'lov qayerdan uzaytiriladi: muddat hali o'tmagan bo'lsa — o'sha sanadan, o'tgan bo'lsa — bugundan */
const nextPaidUntil = card => plusMonth(card && card.paidUntil && card.paidUntil > todayDay() ? card.paidUntil : todayDay());

function quick(id) {
  const d = $('quick');
  quickId = id;
  if (!quickDraw()) return;
  if (!d.open) d.showModal();
}
function quickClose() { quickId = null; if ($('quick').open) $('quick').close(); }
$('quick').addEventListener('close', () => { quickId = null; });
// Oyna tashqarisini bosish — yopadi (ichidagi bosish .qwrap ga tushadi)
$('quick').addEventListener('click', e => { if (e.target === $('quick')) quickClose(); });

/** Amaldan keyin: ro'yxat yangilanadi, oyna yangi holat bilan qayta chiziladi */
async function quickAfter() {
  await load();
  if (quickId) quickDraw();
}

function quickDraw() {
  const c = clientById(quickId);
  if (!c) { quickClose(); return false; }
  const card = c.card || {}, a = c.access || { state: 'active' }, stopped = a.state === 'blocked' || !!c.heldElsewhere, st = stateOf(c);
  const wrap = el('div', 'qwrap'), head = el('header'), title = el('div');
  const h = el('h2', '', titleOf(c));
  h.id = 'qTitle';
  const sub = el('p');
  sub.append(el('span', 'pill ' + { on: 'ok', off: 'bad', bad: 'bad', new: 'warn' }[st], { on: 'aloqada', off: "aloqa yo'q", bad: 'muammo bor', new: c.approved ? 'sozlanmoqda' : 'tasdiqlanmagan' }[st]),
    document.createTextNode(' ' + [card.owner, card.phone, card.city, card.paidUntil ? "to'langan: " + dateText(card.paidUntil) : null].filter(Boolean).join(' · ')));
  title.append(h, sub);
  const x = el('button', 'x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Yopish');
  x.onclick = quickClose;
  head.append(title, x);
  wrap.append(head);

  const go = el('div', 'actions');
  if (!(view === 'client' && openId === c.id)) {
    const open = el('button', 'btn ghost sm', 'Sahifasini ochish');
    open.type = 'button';
    open.onclick = () => { quickClose(); openClient(c.id); };
    go.append(open);
  }
  if (c.approved) {
    const panel = el('button', 'btn ghost sm', 'Panelni ochish');
    panel.type = 'button';
    panel.disabled = !c.online;
    panel.onclick = () => enter(c, go, panel);
    go.append(panel);
  }
  if (go.childElementCount) wrap.append(go);

  if (!founder()) {
    wrap.append(el('p', 'meta', "To'xtatish, yoqish va o'chirish — faqat asoschi."));
  } else if (!c.approved) {
    wrap.append(pendingPart(c));
  } else {
    wrap.append(stopped ? resumePart(c) : stopPart(c, a));
  }
  if (founder()) wrap.append(deletePart(c));
  $('quick').replaceChildren(wrap);
  return true;
}

// ─── Tasdiqlanmagan yozuv: tasdiqlash yoki shunchaki o'chirish (o'zi ulangan soxta/takror yozuv) ───
function pendingPart(c) {
  const box = el('section', 'qpart');
  box.append(el('h3', '', 'Tasdiqlanmagan'), el('p', 'meta', "Kompyuter Hub'ga o'zi ulangan, lekin siz hali tasdiqlamagansiz. Tanimasangiz — o'chiring."));
  const row = el('div', 'actions'), ok = el('button', 'btn sm', 'Tasdiqlash va aktivlashtirish');
  ok.type = 'button';
  ok.onclick = async () => { await approve(c, ok); if (quickId) quickDraw(); };
  row.append(ok);
  box.append(row);
  return box;
}

// ─── Ishlab turibdi: to'xtatish (yoki faqat eslatma) ───
function stopPart(c, a) {
  const box = el('section', 'qpart');
  const head = el('div', 'row');
  head.append(el('h3', '', 'Ishlash'), el('span', 'pill ' + ACCESS_PILL[a.state], ACCESS_TEXT[a.state]));
  box.append(head);
  const note = appliedNote(c);
  if (note) box.append(el('p', 'meta', note));
  const msg = el('textarea');
  msg.rows = 2;
  msg.maxLength = 300;
  msg.value = a.message || STOP_TEXT;
  const lbl = el('label', 'f wide', "Klinika ko'radigan matn (panelda va egasining Telegram'ida)");
  lbl.append(msg);
  box.append(lbl);
  const row = el('div', 'actions');
  const stop = el('button', 'btn sm danger', "To'xtatish");
  stop.type = 'button';
  stop.onclick = () => quickAccess(c, 'blocked', msg.value.trim(), stop);
  row.append(stop);
  if (a.state === 'warn') {
    const clear = el('button', 'btn ghost sm', 'Eslatmani olib tashlash');
    clear.type = 'button';
    clear.onclick = () => quickAccess(c, 'active', '', clear);
    row.append(clear);
  } else {
    const warn = el('button', 'btn ghost sm', "Faqat eslatma ko'rsatish");
    warn.type = 'button';
    warn.title = "Ishlab turadi, panelda shu matn ko'rinadi";
    warn.onclick = () => quickAccess(c, 'warn', msg.value.trim(), warn);
    row.append(warn);
  }
  box.append(row, el('p', 'meta', "To'xtasa: panel va AI xodimlar ishlamaydi, qo'ng'iroqlarni administrator oladi, bemor xabarlari xodimlarga boradi. Ma'lumot o'chmaydi. Klinika 5 daqiqagacha oladi."));
  return box;
}

// ─── To'xtatilgan: pul to'ladi — yoqish, to'langan sana bir oyga suriladi ───
function resumePart(c) {
  const box = el('section', 'qpart');
  const head = el('div', 'row');
  head.append(el('h3', '', 'Ishlash'), el('span', 'pill bad', c.heldElsewhere && c.access.state !== 'blocked' ? "To'xtatilgan — boshqa yozuvda" : "To'xtatilgan"));
  box.append(head);
  if (c.access && c.access.updatedAt) box.append(el('p', 'meta', (c.access.updatedBy || '—') + ' to\'xtatgan · ' + ago(c.access.updatedAt)));
  const next = nextPaidUntil(c.card);
  const ext = el('label', 'chk'), cb = el('input');
  cb.type = 'checkbox';
  cb.checked = true;
  ext.append(cb, el('span', '', "To'langan sanani bir oyga surish — " + dateText(next) + ' gacha'));
  const row = el('div', 'actions'), on = el('button', 'btn sm', "To'ladi — yoqish");
  on.type = 'button';
  on.onclick = () => quickResume(c, cb.checked ? next : null, on);
  row.append(on);
  box.append(ext, row, el('p', 'meta', 'Klinika 5 daqiqagacha oladi — panel va AI xodimlar qayta ishlaydi.'));
  return box;
}

function quickAccess(c, state, message, btn) {
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/access', { state, message });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    say({ active: 'Yoqildi', warn: "Eslatma qo'yildi", blocked: "To'xtatildi" }[state] + (r.j.signed ? ' — klinika 5 daqiqagacha oladi' : " — Hub'da imzo kaliti yo'q, klinikaga yetmaydi"));
    await quickAfter();
  });
}

function quickResume(c, paidUntil, btn) {
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/access', { state: 'active', message: '' });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    let paidNote = '';
    if (paidUntil) {
      // Karta to'liq almashtiriladi (clients.ts save) — qolgan maydonlar o'zgarmasin
      const card = c.card || {};
      const w = await call('/admin/clinics/' + c.id + '/card', { kind: card.kind || '', owner: card.owner || '', phone: card.phone || '', city: card.city || '', plan: card.plan ?? '', paidUntil, note: card.note || '' });
      paidNote = w && w.ok ? ", to'langan: " + dateText(paidUntil) + ' gacha' : " — lekin sana yozilmadi: " + ((w && w.j.error) || 'xato');
    }
    say('Yoqildi' + paidNote + (r.j.signed ? ' · klinika 5 daqiqagacha oladi' : " · Hub'da imzo kaliti yo'q, klinikaga yetmaydi"));
    await quickAfter();
  });
}

// ─── Butunlay o'chirish: tasdiqlangan mijoz — nomini aynan yozib (server ham tekshiradi) ───
function deletePart(c) {
  const box = el('section', 'qpart danger-zone');
  box.append(el('h3', '', "Butunlay o'chirish"));
  box.append(el('p', 'meta', c.approved
    ? "Karta, zaxiralar va jurnal yozuvlari o'chadi. Kompyuteri Hub'ga ulana olmaydi va 30 kundan keyin o'zi to'xtaydi. Qaytarib bo'lmaydi."
    : "Faqat Hub'dagi yozuv o'chadi. Kompyuter yana ulansa — yangi tasdiqlanmagan yozuv bo'lib tushadi."));
  const row = el('div', 'actions'), del = el('button', 'btn sm danger', "O'chirish");
  del.type = 'button';
  let typed = null;
  if (c.approved) {
    typed = el('input');
    typed.placeholder = 'Tasdiqlash uchun nomini yozing: ' + c.name;
    typed.setAttribute('aria-label', 'Mijoz nomi');
    typed.maxLength = 120;
    del.disabled = true;
    typed.oninput = () => { del.disabled = typed.value.trim() !== c.name.trim(); };
    row.append(typed);
  }
  del.onclick = () => guarded(del, async () => {
    if (!c.approved && !confirm('«' + c.name + "» yozuvi o'chirilsinmi?")) return;
    const r = await call('/admin/clinics/' + c.id + '/delete', c.approved ? { confirm: typed.value.trim() } : {});
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    say('«' + c.name + "» o'chirildi");
    quickClose();
    if (openId === c.id) closeClient();
    await load();
  });
  row.append(del);
  box.append(row);
  return box;
}
`;
