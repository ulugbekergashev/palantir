/**
 * Boshqaruv markazi — mijoz oynasidagi «Masofadan boshqarish» (hub/server.ts 17-band, commands.ts). adminDrawer.ts dan keyin o'sha
 * <script> da ishlaydi (el, sect, call, guarded, say, api, load, ago, drawClient yordamchilari bilan).
 * Tugmalar: diagnostika olish, qayta ishga tushirish, hozir yangilash, telefon xizmatini o'rnatish, kompyuterni qayta yoqish, egasiga xabar.
 * Har buyruq egasiga Telegram'da aytiladi.
 * Pastda — oxirgi buyruqlar va klinika javobi (diagnostika shu yerda ochiladi).
 */
export const ADMIN_COMMANDS_JS = String.raw`
const CMD_LABEL = { diag: 'Diagnostika', restart: 'Qayta ishga tushirish', update: 'Yangilash', message: 'Egasiga xabar', phone: "Telefon xizmatini o'rnatish", reboot: 'Kompyuterni qayta yoqish' };
const CMD_STATE = { sent: ['warn', 'kutilmoqda'], done: ['ok', 'bajarildi'], failed: ['bad', 'bajarilmadi'], expired: ['bad', "muddati o'tdi"] };
/** 0.4.18 dan eski Palantir buyruqni tushunmaydi — navbatda turib qoladi */
const COMMANDS_FROM = [0, 4, 18];
const versionAtLeast = (v, want) => { const p = String(v || '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((p[i] || 0) !== want[i]) return (p[i] || 0) > want[i]; } return true; };
const PHONE_PHASE = { running: "o'rnatilyapti", reboot: 'kompyuterni qayta yoqish kerak', rebooted: "qayta yondi — o'rnatish davom etadi", done: "o'rnatilgan", failed: "o'rnatilmadi", stalled: "o'rnatish to'xtab qolgan" };
/** «Holat» bo'limidagi «Telefon xizmati» qatori (heartbeat phoneInstall) */
function phoneInstallText(p) {
  if (!p) return null;
  const head = p.phase ? PHONE_PHASE[p.phase] + (p.phase === 'running' && p.step ? ' — ' + p.step : '') + (p.phase === 'failed' && p.note ? ': ' + p.note : '') + (p.at ? ' · ' + ago(p.at) : '') : "o'rnatilmagan";
  return head + (p.remote === false ? " · masofadan o'rnatish yoqilmagan (bir marta klinikada)" : '');
}

function commandsSect(c) {
  const box = sect('Masofadan boshqarish');
  const s = c.status || {}, ver = s.version;
  const old = ver && !versionAtLeast(ver, COMMANDS_FROM);
  box.append(el('div', 'meta', old
    ? 'Klinika (v' + ver + ") bu buyruqlarni hali tushunmaydi — 0.4.18 nashri kerak (kechasi o'zi yangilanadi)"
    : "Har amal egasiga Telegram'da aytiladi. Telefonda suhbat ketayotgan bo'lsa, qayta ishga tushirish va yangilash u tugashini kutadi."));
  const btns = el('div', 'actions');
  const add = (label, cls, action, ask) => {
    const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.disabled = !!old;
    b.onclick = () => { if (ask && !confirm(ask)) return; sendCommand(c, { action }, b); };
    btns.append(b);
  };
  add('Diagnostika olish', 'ghost', 'diag', null);
  add('Qayta ishga tushirish', 'ghost', 'restart', '«' + c.name + "» da Palantir qayta ishga tushirilsinmi?\n\nPanel va AI xodimlar ~1 daqiqa ishlamaydi. Egasiga Telegram'da aytiladi.");
  const behind = data.latest && ver && data.latest !== ver;
  add(behind ? 'Hozir yangilash (v' + data.latest + ')' : 'Hozir yangilash', 'ghost', 'update', '«' + c.name + "» hozir yangilansinmi?\n\nBir necha daqiqa panel ochilmasligi mumkin. Yangi nashr ishlamasa — eskisiga o'zi qaytadi. Egasiga Telegram'da aytiladi.");
  box.append(btns);

  // Telefon xizmati: klinikada hech kim hech narsa bosmaydi (Windows vazifasi orqali). Qayta yoqish — WSL birinchi marta yoqilganda kerak
  // Klinika bu buyruqlarni tushunadimi — versiya raqamiga emas, heartbeat'dagi «phoneInstall» ga qarab (faqat yangi kod yuboradi):
  // tushunmagan klinikaga buyruq 2 soat «kutilmoqda» bo'lib, qayta ishga tushirish va yangilashni ham to'sib turardi
  const phoneOld = !s.phoneInstall;
  const tel = el('div', 'actions');
  const addTel = (label, action, ask) => {
    const b = el('button', 'btn sm ghost', label);
    b.type = 'button';
    b.disabled = !!old || phoneOld;
    b.onclick = () => { if (ask && !confirm(ask)) return; sendCommand(c, { action }, b); };
    tel.append(b);
  };
  addTel("Telefon xizmatini o'rnatish", 'phone', '«' + c.name + "» kompyuteriga telefon xizmati (WSL + Asterisk) o'rnatilsinmi?\n\n5–15 daqiqa, ekranda hech narsa ochilmaydi. Natija o'rnatish tugaganda shu yerda chiqadi. Egasiga Telegram'da aytiladi.");
  addTel('Kompyuterni qayta yoqish', 'reboot', '«' + c.name + "» kompyuteri qayta yoqilsinmi?\n\n1 daqiqadan keyin qayta yonadi (telefonda suhbat bo'lsa — tugashini kutadi). Ochiq dasturlardagi saqlanmagan ish yo'qolishi mumkin. Egasiga Telegram'da aytiladi.");
  box.append(el('div', 'meta', phoneOld && !old
    ? "Telefon xizmatini o'rnatish va qayta yoqish — 0.4.26 nashridan (kechasi o'zi yangilanadi)"
    : s.phoneInstall && s.phoneInstall.remote === false
      ? "Bu kompyuterda masofadan o'rnatish hali yoqilmagan: bir marta klinikada «Telefon xizmatini o'rnatish» (Sozlamalar → Telefon liniyasi) va Windows so'roviga «Ha». Keyin — shu yerdan"
      : "Telefon xizmati — administrator so'rovisiz, klinikada hech kim hech narsa bosmaydi. Shahar raqami — «Panelni ochish» → Sozlamalar → Telefon liniyasi"), tel);

  const msg = el('textarea');
  msg.maxLength = 1000;
  msg.rows = 2;
  msg.placeholder = "Masalan: «Ertaga 10:00 da o'rnatuvchi keladi — kompyuterni o'chirmang»";
  msg.oninput = () => { $('drawer').dataset.dirty = msg.value.trim() ? '1' : '0'; };
  const lbl = el('label', 'f wide', "Egasiga xabar (Telegram'da va panel jurnalida)");
  lbl.append(msg);
  const send = el('button', 'btn sm', 'Yuborish');
  send.type = 'button';
  send.disabled = !!old;
  send.onclick = () => {
    const text = msg.value.trim();
    if (text.length < 3) return say('Xabar matnini yozing');
    sendCommand(c, { action: 'message', text }, send, () => { msg.value = ''; });
  };
  const row = el('div', 'actions');
  row.append(send);
  box.append(lbl, row);

  const list = c.commands || [];
  if (list.length) {
    const ul = el('ul', 'cmds');
    for (const k of list) ul.append(commandRow(c, k));
    box.append(ul);
  }
  return box;
}

function commandRow(c, k) {
  const li = el('li'), head = el('div', 'row'), st = CMD_STATE[k.state] || CMD_STATE.sent;
  head.append(el('b', '', CMD_LABEL[k.action] || k.action), el('span', 'pill ' + st[0], st[1]),
    el('small', 'meta', (k.by || 'asosiy kalit') + ' · ' + ago(k.createdAt)));
  li.append(head);
  if (k.text) li.append(el('blockquote', 'quote', '«' + k.text + '»'));
  const note = k.note || (k.state === 'sent' ? (k.action === 'phone' ? "O'rnatish tugaganda natija shu yerda chiqadi (5–15 daqiqa)" : c.online ? 'Klinika bir necha soniyada oladi' : 'Klinika aloqada emas — ulanganda oladi')
    : k.state === 'expired' ? (k.action === 'phone' ? '2 soat ichida javob kelmadi — diagnostikani oling' : k.action === 'reboot' ? 'Klinika 5 daqiqa ichida olmadi — bajarilmaydi (kutilmaganda qayta yonmasin)' : 'Klinika 30 daqiqa ichida olmadi — bajarilmaydi') : null);
  if (note) li.append(el('div', 'meta', note));
  if (k.diag) {
    const tools = el('div', 'row'), show = el('button', 'btn ghost sm', "Diagnostikani ko'rish");
    show.type = 'button';
    show.onclick = async () => {
      const shown = li.querySelector('pre');
      if (shown) { shown.remove(); $('drawer').dataset.dirty = '0'; return; }
      const x = await api('/admin/diag/' + c.id + '/' + k.diag).catch(() => null);
      // Ochiq diagnostika avtomatik yangilanishda yo'qolmasin
      $('drawer').dataset.dirty = '1';
      tools.after(el('pre', '', x && x.ok ? await x.text() : "Diagnostikani o'qib bo'lmadi"));
    };
    tools.append(show);
    li.append(tools);
  }
  return li;
}

function sendCommand(c, body, btn, sent) {
  return guarded(btn, async () => {
    const r = await call('/admin/clinics/' + c.id + '/command', body);
    if (!r) return;
    if (!r.ok) return say(r.j.error || 'Xato: ' + r.status);
    if (sent) sent();
    c.commands = [r.j.command, ...(c.commands || [])].slice(0, 6);
    $('drawer').dataset.dirty = '0';
    say(CMD_LABEL[body.action] + ' — yuborildi' + (c.online ? '' : ' (klinika ulanganda oladi)'));
    drawClient(false);
    // Natija odatda bir necha soniyada keladi — ro'yxat oddiy navbatini kutmay yangilanadi
    for (const ms of [4000, 12000, 30000]) setTimeout(load, ms);
  });
}
`;
