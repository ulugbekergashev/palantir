/**
 * Boshqaruv markazi — mijoz oynasidagi «Tarif: AI xodimlar va modullar» (hub/server.ts 16-band). adminDrawer.ts dan keyin o'sha <script> da
 * ishlaydi (el, sect, call, guarded, say, founder, render, drawClient yordamchilari bilan).
 * Belgilangan modul klinikada yoqiq; olib tashlangani — menyudan chiqadi va fonda ishlamaydi (ma'lumoti o'chmaydi). Asosiy xodimlar
 * (AI administrator, Palantir) tarifga bog'liq emas. «uses» — klinika amalda ishlatayotgani (heartbeat): o'chirishdan oldin ko'rinsin.
 */
export const ADMIN_PLAN_JS = String.raw`
// licenseKey.ts MODULES bilan bir xil tartib (scripts/check-hub-access.ts tekshiradi)
const PLAN_MODULES = [
  ['direktor', 'Direktor', 'jamoani boshqaradi, kunlik reja'],
  ['tahlilchi', 'Tahlilchi', 'hisobotlar va raqamlar'],
  ['kuzatuvchi', 'Kuzatuvchi', 'kameralar'],
  ['marketolog', 'Marketolog', 'bozor tahlili (Meta AI)'],
  ['kontent', 'Kontent-meyker', 'postlar va video'],
  ['target', 'Targetolog', 'reklama kampaniyalari'],
  ['rekruter', 'Rekruter', 'vakansiya va nomzodlar'],
  ['murabbiy', 'Murabbiy', "xodimlarni o'qitish"],
  ['telefon', 'Telefonda AI', "qo'ng'iroqqa AI javob beradi"],
];

/** Tanlov klinikaga yetdimi: 0.4.17 dan eski klinika tarifni bilmaydi (hammasi ishlaydi) */
function planNote(c) {
  const want = c.plan && c.plan.modules, got = c.status ? c.status.modules : undefined;
  if (got === undefined) return want ? "Klinika tarifni hali tushunmaydi — 0.4.17 nashri kerak (kechasi o'zi yangilanadi). Hozircha hammasi ishlaydi" : null;
  const same = (want === null && got === null) || (!!want && !!got && want.length === got.length && want.every(m => got.includes(m)));
  if (same) return want ? 'Klinikada amalda' : null;
  return c.online ? 'Klinikaga 5 daqiqagacha yetadi' : "Klinika aloqada emas — ulanganda yetadi";
}

function planSect(c) {
  const plan = c.plan || { modules: null, set: false, inherited: false }, box = sect('Tarif: AI xodimlar va modullar');
  const on = plan.modules ? plan.modules.length : PLAN_MODULES.length;
  const head = el('div', 'row');
  head.append(el('span', 'pill ' + (plan.modules ? 'warn' : 'ok'), plan.modules ? on + ' / ' + PLAN_MODULES.length + ' yoqiq' : 'Hammasi yoqiq'));
  if (plan.inherited) head.append(el('small', 'meta', "shu kompyuterning boshqa yozuvidagi tanlov"));
  else if (c.access && c.access.modulesAt) head.append(el('small', 'meta', (c.access.modulesBy || '—') + ' · ' + ago(c.access.modulesAt)));
  box.append(head, el('div', 'meta', "AI administrator va Palantir — doim bor. O'chirilgan xodim menyudan chiqadi va ishlamaydi; ma'lumoti o'chmaydi."));
  const note = planNote(c);
  if (note) box.append(el('div', 'meta', note));
  const uses = (c.status && c.status.uses) || [];
  const list = el('ul', 'plan');
  const boxes = {};
  for (const [id, name, about] of PLAN_MODULES) {
    const li = el('li'), lbl = el('label', 'chk');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !plan.modules || plan.modules.includes(id);
    cb.disabled = !founder();
    cb.onchange = () => { $('drawer').dataset.dirty = '1'; };
    boxes[id] = cb;
    lbl.append(cb, el('span', 'name', name), el('small', 'meta', about));
    li.append(lbl);
    if (uses.includes(id)) li.append(el('span', 'pill ok', 'ishlatyapti'));
    list.append(li);
  }
  box.append(list);
  if (!founder()) return box;
  const btns = el('div', 'actions');
  const save = el('button', 'btn sm', 'Tarifni saqlash');
  save.type = 'button';
  save.onclick = () => {
    const picked = PLAN_MODULES.map(m => m[0]).filter(id => boxes[id].checked);
    const dropped = PLAN_MODULES.filter(m => !boxes[m[0]].checked && uses.includes(m[0])).map(m => m[1]);
    if (dropped.length && !confirm('Klinika ishlatayotgan xodimlar o\'chadi: ' + dropped.join(', ') + ".\n\nUlar menyudan chiqadi va ishlamaydi (ma'lumoti saqlanadi). Davom etilsinmi?")) return;
    setPlan(c, picked.length === PLAN_MODULES.length ? 'all' : picked, save);
  };
  const all = el('button', 'btn sm ghost', 'Hammasini yoqish');
  all.type = 'button';
  all.onclick = () => { for (const id in boxes) boxes[id].checked = true; $('drawer').dataset.dirty = '1'; };
  btns.append(save, all);
  box.append(btns);
  return box;
}

function setPlan(c, modules, btn) {
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/modules', { modules });
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    c.access = r.j.access;
    c.plan = { modules: r.j.access.modules, set: true, inherited: false };
    $('drawer').dataset.dirty = '0';
    say('Tarif saqlandi' + (r.j.signed ? ' — klinika 5 daqiqagacha oladi' : " — Hub'da imzo kaliti yo'q, klinikaga yetmaydi"));
    render();
    drawClient(false);
  });
}
`;
