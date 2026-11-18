/**
 * Masofadan amallar (hub/server.ts 17-band): Hub tomonida buyruqlar ro'yxati (hub/commands.ts — xotiradagi baza) va klinika tomonida
 * bajarish (server/hubCommands.ts — soxta Hub, soxta nazoratchi va yangilovchi bilan): diagnostika, xabar, qayta ishga tushirish,
 * yangilash, takror kelgan buyruq, qo'ng'iroqni kutish, egasiga aytish. Ishga tushirish: npm run test:hub-commands
 */
import './isolate';
import { DatabaseSync } from 'node:sqlite';

const { createCommands, CommandError, COMMAND_FRESH_MS, COMMANDS_PER_HOUR } = await import('../hub/commands');
const { maskPeople, onCommand, parseCommand } = await import('../server/hubCommands');
const { businesses, sql } = await import('../server/db');

const { lineBusy, markLineCall, forgetLineCalls, CALL_BUSY_MS } = await import('../server/voice/lineCalls');
const { ADMIN_COMMANDS_JS } = await import('../hub/adminCommands');
const { adminPage } = await import('../hub/admin');

let failed = 0;
function ok(name: string, cond: boolean, info = ''): void {
  if (!cond) failed++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${!cond && info ? ` — ${info}` : ''}`);
}
const rejects = (fn: () => unknown, code: number, text = '') => {
  try { fn(); return false; } catch (e) { return e instanceof CommandError && e.code === code && e.message.includes(text); }
};

console.log('\n# Hub: buyruqlar ro\'yxati');
{
  let clock = new Date('2026-11-16T10:00:00Z');
  const cmds = createCommands(new DatabaseSync(':memory:'), () => clock);
  ok("noma'lum amal — rad", rejects(() => cmds.create('k1', { action: 'format' }, 'Ali'), 400));
  ok('bo\'sh xabar — rad', rejects(() => cmds.create('k1', { action: 'message', text: '  ' }, 'Ali'), 400, 'matn'));
  const d = cmds.create('k1', { action: 'diag', text: 'kerak emas' }, '  Ali\n  Valiyev ');
  ok("yoziladi: kutilmoqda, xabar matni faqat «message» da, ism bir qator", d.state === 'sent' && d.text === null && d.by === 'Ali Valiyev' && /^[0-9a-f]{12}$/.test(d.id), JSON.stringify(d));
  ok('shu amaldan javob kutilayotgan bo\'lsa — ikkinchisi rad (409)', rejects(() => cmds.create('k1', { action: 'diag' }, 'Ali'), 409));
  ok('boshqa amal — mumkin', cmds.create('k1', { action: 'restart' }, 'Ali').state === 'sent');
  ok('xabarlar ketma-ket — mumkin', cmds.create('k1', { action: 'message', text: 'Salom' }, 'Ali').state === 'sent' && cmds.create('k1', { action: 'message', text: 'Yana' }, 'Ali').state === 'sent');
  ok("begona klinika javobi — null (o'zgarmaydi)", cmds.finish('k2', d.id, { ok: true }) === null && cmds.get(d.id)!.state === 'sent');
  const done = cmds.finish('k1', d.id, { ok: true, note: 'Diagnostika\u0007 yuborildi' }, 'f.txt')!;
  ok('klinika javobi: bajarildi, izoh tozalanadi, fayl yoziladi', done.state === 'done' && done.note === 'Diagnostika yuborildi' && done.diag === 'f.txt' && !!done.doneAt, JSON.stringify(done));
  ok('takror javob natijani o\'zgartirmaydi', cmds.finish('k1', d.id, { ok: false, note: 'boshqa' })!.state === 'done' && cmds.get(d.id)!.note === 'Diagnostika yuborildi');
  ok('bajarilgandan keyin yana diagnostika — mumkin', cmds.create('k1', { action: 'diag' }, 'Ali').state === 'sent');
  ok("ro'yxat — yangisi tepada, 6 tadan oshmaydi", cmds.recent('k1').length === 5 && cmds.recent('k1')[0].action === 'diag');
  clock = new Date(clock.getTime() + COMMAND_FRESH_MS + 60_000);
  const r = cmds.recent('k1').find(c => c.action === 'restart')!;
  ok("qayta ishga tushirish 30 daqiqada javobsiz — «muddati o'tdi», yangisini berish mumkin", r.state === 'expired' && cmds.create('k1', { action: 'restart' }, 'Ali').state === 'sent');
  ok("diagnostika ham 30 daqiqada javobsiz — «muddati o'tdi» (eski Palantir tushunmagan bo'lsa yangisi yopiq qolmasin)", cmds.recent('k1').find(c => c.action === 'diag')!.state === 'expired' && cmds.create('k1', { action: 'diag' }, 'Ali').state === 'sent');
  ok("qayta ishga tushirish kutilayotganda yangilash — rad (409), xabar — mumkin", rejects(() => cmds.create('k1', { action: 'update' }, 'Ali'), 409, 'qayta ishga') && cmds.create('k1', { action: 'message', text: 'Salom' }, 'Ali').state === 'sent');
  ok('bajarilmadi — failed', cmds.finish('k1', cmds.recent('k1').find(c => c.action === 'restart' && c.state === 'sent')!.id, { ok: false, note: 'nazoratchisiz' })!.state === 'failed');
  for (let i = 0; cmds.recent('k3', 100).length < COMMANDS_PER_HOUR; i++) cmds.create('k3', { action: 'message', text: `xabar ${i}` }, 'Ali');
  ok(`soatiga ${COMMANDS_PER_HOUR} tadan ko'p — rad (429)`, rejects(() => cmds.create('k3', { action: 'message', text: 'yana' }, 'Ali'), 429));
  cmds.remove('k1');
  ok("mijoz o'chirilsa — buyruqlari ham", cmds.recent('k1').length === 0);
}

console.log("\n# Klinika: buyruqni bajarish");
const biz = businesses.create(`buyruq${Date.now()}`, 'x', { name: 'Sinov klinika', ownerName: 'Akmal', industry: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
type State = import('../server/voice/phoneInstall').InstallState;
const fake = () => {
  const s = {
    reports: [] as { id: string; ok: boolean; note: string; diag?: string }[], told: [] as string[], restarted: 0, updates: 0, slept: 0,
    supervised: true, updating: false, busyFor: 0, refuse: null as string | null, order: [] as string[],
    // Telefon o'rnatish: soxta soat, holat fayli va vazifa. script — vazifa ishga tushgandan keyingi holatlar (har kutishda bittadan)
    clock: Date.parse('2026-11-19T10:00:00Z'), state: null as State | null, script: [] as Partial<State>[], started: 0, phoneRefuse: null as string | null,
    rebooted: 0, rebootRefuse: null as string | null,
  };
  const at = () => new Date(s.clock).toISOString();
  // Holat faqat vazifa ishga tushgandan keyin (yoki allaqachon ketayotgan o'rnatishda) o'zgaradi
  const advance = () => { if (s.started === 0 && s.state?.phase !== 'running') return; const next = s.script.shift(); if (next) s.state = { phase: 'running', note: '', step: '', pid: 1, at: at(), ...next }; };
  return {
    s,
    deps: {
      report: async (id: string, r: { ok: boolean; note: string; diag?: string }) => { s.reports.push({ id, ...r }); s.order.push('report'); },
      supervised: () => s.supervised,
      updating: () => s.updating,
      restart: () => { s.restarted++; s.order.push('restart'); },
      startUpdate: () => { if (s.refuse) return s.refuse; s.updates++; return null; },
      lineBusy: () => s.busyFor > 0,
      sleep: async (ms: number) => { s.slept += ms; s.clock += ms; s.busyFor = Math.max(0, s.busyFor - ms); advance(); },
      notify: async (_b: unknown, html: string) => { s.told.push(html); return 1; },
      phoneStart: async () => { if (s.phoneRefuse) return s.phoneRefuse; s.started++; return null; },
      phoneState: () => s.state,
      phoneFail: (note: string) => { s.state = { phase: 'failed', note, step: '', pid: 0, at: at() }; },
      reboot: () => { if (s.rebootRefuse) return s.rebootRefuse; s.rebooted++; return null; },
      now: () => s.clock,
    },
  };
};
const id = (n: number) => n.toString(16).padStart(12, 'a');
const feed = () => sql.many("SELECT title, body FROM agent_events WHERE business_id = ? AND member = 'yordamchi' ORDER BY at", r => ({ title: String(r.title), body: String(r.body) }), biz.id);
{
  ok("noto'g'ri yuk — tushunilmaydi", parseCommand({ id: 'x', action: 'diag' }) === null && parseCommand({ id: id(1), action: 'rm' }) === null && parseCommand({ id: id(1), action: 'message', text: ' ' }) === null);
  ok('to\'g\'ri yuk', parseCommand({ id: id(1), action: 'message', text: ' Salom ', by: 'Ali\u0000' })?.text === 'Salom' && parseCommand({ id: id(1), action: 'diag', by: 'Ali\u0000' })?.by === 'Ali');

  const f = fake();
  await onCommand({ id: id(1), action: 'diag', by: 'Ali' }, f.deps);
  const rep = f.s.reports[0];
  ok("diagnostika: matn Hub'ga, egasiga aytiladi", rep?.ok === true && !!rep.diag?.includes('Palantir diagnostika') && f.s.told.length === 1 && f.s.told[0].includes('Ali') && f.s.told[0].includes('parol'), JSON.stringify({ ...rep, diag: rep?.diag?.length }));
  ok("diagnostikada .env sirlari yo'q", !/SESSION_SECRET|sinov-secret/.test(rep?.diag ?? ''));

  const f2 = fake();
  await onCommand({ id: id(1), action: 'diag', by: 'Ali' }, f2.deps);
  ok('takror kelgan buyruq bajarilmaydi — avvalgi natija qayta yuboriladi', f2.s.told.length === 0 && f2.s.reports.length === 1 && f2.s.reports[0].ok && !f2.s.reports[0].diag);

  const f3 = fake();
  await onCommand({ id: id(2), action: 'message', text: 'Ertaga <b>10:00</b> da keladi', by: null }, f3.deps);
  ok("xabar: egasiga (HTML tozalangan) va panel jurnaliga", f3.s.told[0]?.includes('Palantir jamoasi') && f3.s.told[0].includes('&lt;b&gt;10:00&lt;/b&gt;') && feed().some(e => e.body.includes('Ertaga <b>10:00</b>')) && f3.s.reports[0]?.ok === true, f3.s.told[0]);

  const f4 = fake();
  f4.s.supervised = false;
  await onCommand({ id: id(3), action: 'restart', by: 'Ali' }, f4.deps);
  ok("nazoratchisiz — qayta ishga tushirilmaydi, sababi aytiladi", f4.s.restarted === 0 && f4.s.reports[0]?.ok === false && f4.s.reports[0].note.includes('nazoratchisiz') && f4.s.told.length === 0);

  const f5 = fake();
  f5.s.busyFor = 40_000;
  await onCommand({ id: id(4), action: 'restart', by: 'Ali' }, f5.deps);
  ok("qayta ishga tushirish: qo'ng'iroq tugashini kutadi, egasiga aytadi, natija Hub'ga OLDIN ketadi", f5.s.slept >= 40_000 && f5.s.restarted === 1 && f5.s.told.length === 1 && f5.s.order.join(',') === 'report,restart' && f5.s.reports[0].ok, JSON.stringify(f5.s));

  const f6 = fake();
  f6.s.busyFor = 60 * 60_000;
  await onCommand({ id: id(5), action: 'restart' }, f6.deps);
  ok("qo'ng'iroq 15 daqiqada tugamasa — suhbat uzilmaydi, bajarilmaydi, sababi Hub'ga", f6.s.slept === 15 * 60_000 && f6.s.restarted === 0 && f6.s.reports[0]?.ok === false && f6.s.reports[0].note.includes('suhbat'), JSON.stringify(f6.s.reports));

  const f6b = fake();
  f6b.s.updating = true;
  await onCommand({ id: id(10), action: 'restart' }, f6b.deps);
  ok("yangilash ketayotganda qayta ishga tushirilmaydi", f6b.s.restarted === 0 && f6b.s.reports[0]?.ok === false && f6b.s.reports[0].note.includes('Yangilash'));

  const f7 = fake();
  await onCommand({ id: id(6), action: 'update', by: 'Ali' }, f7.deps);
  ok('yangilash: yangilovchi ishga tushadi, egasiga aytiladi', f7.s.updates === 1 && f7.s.reports[0]?.ok === true && f7.s.told[0]?.includes('yangi nashr'));

  const f8 = fake();
  f8.s.refuse = 'Yangilash allaqachon ketyapti';
  await onCommand({ id: id(7), action: 'update' }, f8.deps);
  ok("yangilovchi rad etsa — sababi Hub'ga, egasini bezovta qilmaydi", f8.s.reports[0]?.ok === false && f8.s.reports[0].note === 'Yangilash allaqachon ketyapti' && f8.s.told.length === 0);

  const f9 = fake();
  f9.deps.notify = async () => { throw new Error('Telegram yo\'q'); };
  await onCommand({ id: id(8), action: 'message', text: 'Salom' }, f9.deps);
  ok("Telegram ishlamasa — natija Hub'ga boradi va «yetkazildi» deb aldamaydi", f9.s.reports[0]?.ok === true && f9.s.reports[0].note.includes('yetmadi'), f9.s.reports[0]?.note);

  const f9b = fake();
  f9b.deps.notify = () => new Promise(() => { /* Telegram osilib qoldi */ });
  const t0 = Date.now();
  await onCommand({ id: id(11), action: 'message', text: 'Salom' }, f9b.deps);
  ok("Telegram osilib qolsa — 15 soniyada voz kechadi, natija baribir Hub'ga", f9b.s.reports.length === 1 && Date.now() - t0 < 20_000);

  const f10 = fake();
  f10.deps.report = async () => { throw new Error('Hub yo\'q'); };
  f10.s.order = [];
  await onCommand({ id: id(9), action: 'restart' }, f10.deps);
  ok("natija Hub'ga yetmasa ham qayta ishga tushadi (keyin takror kelganda natija qayta yuboriladi)", f10.s.restarted === 1);
}

console.log("\n# Telefon xizmatini masofadan o'rnatish va kompyuterni qayta yoqish");
{
  const { installState, parseInstallStatus } = await import('../server/voice/phoneInstall');
  const st = (phase: string, at = '2026-11-19T10:00:00Z', pid = 42) => JSON.stringify({ phase, note: 'n', step: 'Asterisk', pid, at });
  const boot = Date.parse('2026-11-19T09:00:00Z');
  ok("holat fayli: BOM bilan ham o'qiladi, noma'lum holat — null", parseInstallStatus('﻿' + st('done'))?.phase === 'done' && parseInstallStatus(st('format')) === null && parseInstallStatus('x') === null);
  ok("ishlayapti, jarayon tirik — running", installState(parseInstallStatus(st('running')), () => true, boot)?.phase === 'running');
  ok("ishlayapti deb yozilgan, jarayon yo'q — stalled", installState(parseInstallStatus(st('running')), () => false, boot)?.phase === 'stalled');
  ok("ishlayapti deb yozilgan, keyin kompyuter qayta yongan (jarayon raqami begona) — stalled", installState(parseInstallStatus(st('running')), () => true, Date.parse('2026-11-19T11:00:00Z'))?.phase === 'stalled');
  ok("qayta yoqish kerak edi va kompyuter keyin yongan — rebooted; hali yonmagan — reboot",
    installState(parseInstallStatus(st('reboot')), () => false, Date.parse('2026-11-19T11:00:00Z'))?.phase === 'rebooted' && installState(parseInstallStatus(st('reboot')), () => false, boot)?.phase === 'reboot');
  ok("«qayta yoqish kerak» 2 kundan eski — o'zi davom ettirilmaydi (stalled)", installState(parseInstallStatus(st('reboot')), () => false, Date.parse('2026-11-25T10:00:00Z'))?.phase === 'stalled');

  const p1 = fake();
  p1.s.state = { phase: 'done', note: 'eski', step: '', pid: 1, at: '2026-11-01T10:00:00Z' };
  p1.s.script = [{ step: 'Ubuntu' }, { step: 'Asterisk' }, { phase: 'done', note: "Telefon xizmati o'rnatildi va ishlayapti" }];
  await onCommand({ id: id(20), action: 'phone', by: 'Ali' }, p1.deps);
  ok("o'rnatish: vazifa ishga tushadi, eski «tugadi» hisobga olinmaydi, natija o'rnatish TUGAGANDA Hub'ga, egasiga boshida va oxirida",
    p1.s.started === 1 && p1.s.reports.length === 1 && p1.s.reports[0].ok && p1.s.reports[0].note.includes("o'rnatildi") && p1.s.slept >= 45_000 && p1.s.told.length === 2 && p1.s.told[1].includes('✅'), JSON.stringify(p1.s.reports));

  const p2 = fake();
  p2.s.script = [{ step: 'WSL' }, { phase: 'failed', step: 'WSL', note: "Virtualizatsiya o'chiq" }];
  await onCommand({ id: id(21), action: 'phone' }, p2.deps);
  ok("o'rnatilmadi — sababi va qadami Hub'ga, egasiga «o'rnatildi» deyilmaydi", p2.s.reports[0]?.ok === false && p2.s.reports[0].note.includes('Virtualizatsiya') && p2.s.reports[0].note.includes('WSL') && p2.s.told.length === 1);

  const p3 = fake();
  p3.s.script = [{ phase: 'reboot' }];
  await onCommand({ id: id(22), action: 'phone' }, p3.deps);
  ok("WSL yoqildi — «qayta yoqish kerak» va qaysi tugma bosilishi aytiladi", p3.s.reports[0]?.ok === true && p3.s.reports[0].note.includes('Kompyuterni qayta yoqish'));

  const p4 = fake();
  p4.s.phoneRefuse = "Bu kompyuterda masofadan o'rnatish yoqilmagan";
  await onCommand({ id: id(23), action: 'phone' }, p4.deps);
  ok("vazifa yo'q — sababi darhol Hub'ga, egasi bezovta qilinmaydi, kutilmaydi", p4.s.reports[0]?.ok === false && p4.s.reports[0].note.includes('yoqilmagan') && p4.s.told.length === 0 && p4.s.slept === 0);

  const p5 = fake();
  await onCommand({ id: id(24), action: 'phone' }, p5.deps);
  ok("vazifa ishga tushdi deyildi, lekin holat 3 daqiqada yozilmadi — «boshlanmadi»", p5.s.reports[0]?.ok === false && p5.s.reports[0].note.includes('boshlanmadi') && p5.s.slept <= 4 * 60_000);

  const p6 = fake();
  p6.s.state = { phase: 'running', note: '', step: 'Ubuntu', pid: 7, at: new Date(p6.s.clock - 60_000).toISOString() };
  p6.s.script = [{ phase: 'done', note: 'tayyor' }];
  await onCommand({ id: id(25), action: 'phone' }, p6.deps);
  ok("allaqachon o'rnatilyapti — ikkinchisi boshlanmaydi, o'shaning natijasi kutiladi", p6.s.started === 0 && p6.s.reports[0]?.ok === true && p6.s.reports[0].note === 'tayyor');

  const p6b = fake();
  p6b.s.busyFor = 45_000;
  p6b.s.script = [{}, {}, {}, { phase: 'done', note: 'tayyor' }];
  await onCommand({ id: id(32), action: 'phone' }, p6b.deps);
  ok("telefonda suhbat ketyapti — o'rnatish (Asterisk qayta yonadi) u tugashini kutib boshlanadi", p6b.s.started === 1 && p6b.s.slept >= 45_000 && p6b.s.reports[0]?.ok === true, JSON.stringify(p6b.s.reports));

  const p7 = fake();
  p7.s.updating = true;
  await onCommand({ id: id(26), action: 'phone' }, p7.deps);
  ok("yangilash ketayotganda o'rnatilmaydi", p7.s.started === 0 && p7.s.reports[0]?.ok === false);

  const r1 = fake();
  r1.s.busyFor = 30_000;
  r1.s.state = { phase: 'reboot', note: '', step: 'WSL', pid: 1, at: new Date(r1.s.clock).toISOString() };
  await onCommand({ id: id(27), action: 'reboot', by: 'Ali' }, r1.deps);
  ok("qayta yoqish: qo'ng'iroq tugashini kutadi, egasiga aytadi, o'rnatish davom etishi aytiladi", r1.s.rebooted === 1 && r1.s.slept >= 30_000 && r1.s.told.length === 1 && r1.s.reports[0]?.ok && r1.s.reports[0].note.includes('davom'), JSON.stringify(r1.s.reports));

  const r2 = fake();
  r2.s.state = { phase: 'running', note: '', step: 'Asterisk', pid: 1, at: new Date(r2.s.clock).toISOString() };
  await onCommand({ id: id(28), action: 'reboot' }, r2.deps);
  ok("o'rnatish ketayotganda qayta yoqilmaydi", r2.s.rebooted === 0 && r2.s.reports[0]?.ok === false && r2.s.reports[0].note.includes("o'rnatilyapti"));

  const r3 = fake();
  r3.s.rebootRefuse = 'Bu dasturchi nusxasi';
  await onCommand({ id: id(29), action: 'reboot' }, r3.deps);
  ok("Windows rad etsa — sababi Hub'ga, egasiga «qayta yoqyapti» deyilmaydi", r3.s.reports[0]?.ok === false && r3.s.told.length === 0);

  const r4 = fake();
  r4.s.busyFor = 60 * 60_000;
  await onCommand({ id: id(30), action: 'reboot' }, r4.deps);
  ok("suhbat 15 daqiqada tugamasa — qayta yoqilmaydi", r4.s.rebooted === 0 && r4.s.reports[0]?.note.includes('suhbat'));

  // Server qayta yondi: javobsiz qolgan «phone» buyrug'i natijasi kutiladi va yuboriladi
  const { resumePhoneInstall } = await import('../server/hubCommands');
  const q1 = fake();
  sql.run('INSERT INTO hub_commands (id, action, at) VALUES (?, ?, ?)', id(31), 'phone', new Date(q1.s.clock - 5 * 60_000).toISOString());
  q1.s.state = { phase: 'running', note: '', step: 'Asterisk', pid: 1, at: new Date(q1.s.clock - 60_000).toISOString() };
  q1.s.script = [{ phase: 'done', note: 'tayyor' }];
  await resumePhoneInstall(q1.deps);
  ok("server o'rnatish paytida qayta yondi — javobsiz buyruq natijasi Hub'ga yetadi, vazifa qayta boshlanmaydi",
    q1.s.started === 0 && q1.s.reports.some(r => r.id === id(31) && r.ok) && Number(sql.one('SELECT ok FROM hub_commands WHERE id = ?', r => r.ok, id(31))) === 1);

  const q2 = fake();
  q2.s.state = { phase: 'rebooted', note: '', step: 'WSL', pid: 1, at: new Date(q2.s.clock - 3_600_000).toISOString() };
  q2.s.script = [{ step: 'Ubuntu' }, { phase: 'done', note: 'tayyor' }];
  await resumePhoneInstall(q2.deps);
  ok("kompyuter qayta yondi — o'rnatish o'zi davom etadi, tugaganini egasi biladi", q2.s.started === 1 && q2.s.told.some(t => t.includes('✅')));

  const q2b = fake();
  q2b.s.state = { phase: 'rebooted', note: '', step: 'WSL', pid: 1, at: new Date(q2b.s.clock - 3_600_000).toISOString() };
  q2b.s.phoneRefuse = "masofadan o'rnatish yoqilmagan";
  await resumePhoneInstall(q2b.deps);
  const told = q2b.s.told.length;
  await resumePhoneInstall(q2b.deps);
  ok("qayta yonganda davom ettirib bo'lmadi — egasiga BIR marta aytiladi, keyingi yonishda qayta urinmaydi", told === 1 && q2b.s.told.length === 1 && q2b.s.state?.phase === 'failed');

  const q2c = fake();
  sql.run('INSERT INTO hub_commands (id, action, at) VALUES (?, ?, ?)', id(33), 'phone', new Date(q2c.s.clock - 60_000).toISOString());
  await resumePhoneInstall(q2c.deps);
  ok("buyruq olingan, holat yozilmasdan server qayta yongan — Hub'da osilib qolmaydi («boshlanmadi»)", q2c.s.reports.some(r => r.id === id(33) && !r.ok && r.note.includes('boshlanmadi')));

  const q3 = fake();
  q3.s.state = { phase: 'done', note: '', step: '', pid: 1, at: new Date(q3.s.clock).toISOString() };
  await resumePhoneInstall(q3.deps);
  ok("hech narsa kutilmayotgan bo'lsa — hech narsa qilinmaydi", q3.s.started === 0 && q3.s.reports.length === 0 && q3.s.slept === 0);

  let clock = new Date('2026-11-19T10:00:00Z');
  const cmds = createCommands(new DatabaseSync(':memory:'), () => clock);
  cmds.create('k9', { action: 'phone' }, 'Ali');
  ok("Hub: o'rnatish kutilayotganda qayta yoqish/qayta ishga tushirish/yangilash — rad (409)", ['reboot', 'restart', 'update'].every(a => rejects(() => cmds.create('k9', { action: a }, 'Ali'), 409, "telefon")));
  clock = new Date(clock.getTime() + COMMAND_FRESH_MS + 60_000);
  ok("Hub: o'rnatish 30 daqiqadan keyin ham «kutilmoqda» (2 soatgacha)", cmds.recent('k9')[0].state === 'sent');
  cmds.create('k10', { action: 'reboot' }, 'Ali');
  clock = new Date(clock.getTime() + 6 * 60_000);
  ok("Hub: qayta yoqish 5 daqiqada olinmasa — «muddati o'tdi» (kech ulangan kompyuter kutilmaganda o'chmasin)", cmds.recent('k10')[0].state === 'expired');
}

console.log("\n# Diagnostikada mijozlar niqoblanadi");
{
  const m = maskPeople("[bot] +998 90 123-45-67 yozdi; @akmal_karimov; 998901234567 qo'ng'iroq; port 3200; v0.4.18; email a@b.uz; 2026-11-16 10:00:01");
  ok("telefon raqami va @nom niqoblanadi, port, nashr, sana va email qoladi", !m.includes('123-45') && m.includes('•••67') && !m.includes('akmal_karimov') && m.includes('@•••')
    && !m.includes('901234567') && m.includes('3200') && m.includes('v0.4.18') && m.includes('a@b.uz') && m.includes('2026-11-16 10:00:01'), m);
}

console.log("\n# Telefon: suhbat ketyaptimi");
{
  forgetLineCalls();
  const t = Date.now();
  ok("qo'ng'iroq yo'q — bo'sh", !lineBusy(t));
  markLineCall(biz.id, '+998901234567', t - 60_000);
  ok("1 daqiqa oldin boshlangan — band", lineBusy(t));
  ok(`${CALL_BUSY_MS / 60_000} daqiqadan keyin — bo'sh`, !lineBusy(t + CALL_BUSY_MS));
}

console.log('\n# Admin sahifasi');
{
  let parsed = true;
  try { new Function(ADMIN_COMMANDS_JS); } catch (e) { parsed = false; console.log(`    ${(e as Error).message}`); }
  ok('«Masofadan boshqarish» skripti — sintaksis to\'g\'ri', parsed);
  const page = adminPage();
  ok("sahifada ulangan", page.includes('function commandsSect') && page.includes('commandsSect(c)'));
}

console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
