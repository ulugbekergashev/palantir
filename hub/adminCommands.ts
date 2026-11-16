/**
 * Boshqaruv markazi — mijoz oynasidagi «Masofadan boshqarish» (hub/server.ts 17-band, commands.ts). adminDrawer.ts dan keyin o'sha
 * <script> da ishlaydi (el, sect, call, guarded, say, api, load, ago, drawClient yordamchilari bilan).
 * Tugmalar: diagnostika olish, qayta ishga tushirish, hozir yangilash, egasiga xabar. Har buyruq egasiga Telegram'da aytiladi.
 * Pastda — oxirgi buyruqlar va klinika javobi (diagnostika shu yerda ochiladi).
 */
export const ADMIN_COMMANDS_JS = String.raw`
const CMD_LABEL = { diag: 'Diagnostika', restart: 'Qayta ishga tushirish', update: 'Yangilash', message: 'Egasiga xabar' };
const CMD_STATE = { sent: ['warn', 'kutilmoqda'], done: ['ok', 'bajarildi'], failed: ['bad', 'bajarilmadi'], expired: ['bad', "muddati o'tdi"] };
/** 0.4.18 dan eski Palantir buyruqni tushunmaydi — navbatda turib qoladi */
const COMMANDS_FROM = [0, 4, 18];
const versionAtLeast = (v, want) => { const p = String(v || '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((p[i] || 0) !== want[i]) return (p[i] || 0) > want[i]; } return true; };

function commandsSect(c) {
  const box = sect('Masofadan boshqarish');
  const ver = c.status && c.status.version;
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
  const note = k.note || (k.state === 'sent' ? (c.online ? 'Klinika bir necha soniyada oladi' : 'Klinika aloqada emas — ulanganda oladi') : k.state === 'expired' ? "Klinika 30 daqiqa ichida olmadi — bajarilmaydi" : null);
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
