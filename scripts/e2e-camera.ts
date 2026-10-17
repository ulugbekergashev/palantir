/** Kamera mantig'i sinovlari: zonadagi seanslar va CRM bilan solishtirish (tarmoqsiz, sof funksiyalar) */
import { findings, reconcile, type Sitting } from '../server/camera/reconcile';
import { flush, inZone, step, type Box, type States, type Zone } from '../server/camera/sessions';
import type { Appointment } from '../server/crm/logic';

import type { Harness } from './e2e-crm';
import { ai, sleep } from './fakes';
import { sectionFor } from '../src/lib/commands';
import { buildJournal } from '../src/lib/journal';

type Ok = (name: string, cond: unknown, info?: string) => void;

const CHAIR: Zone = { id: 'z1', x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
const SITTING: Box = { x: 0.45, y: 0.42, w: 0.1, h: 0.16 };
const PASSING: Box = { x: 0.05, y: 0.1, w: 0.1, h: 0.3 };
const T = { enterMs: 20_000, leaveMs: 60_000 };

/** Kadrlarni ketma-ket beradi, har 2 soniyada bittadan: [qaysi soniyadan, qaysi soniyagacha, zonada odam bormi] */
function play(parts: [number, number, boolean][], zones: Zone[] = [CHAIR]) {
  let states: States = {};
  const events = [];
  for (const [from, to, present] of parts) {
    for (let sec = from; sec <= to; sec += 2) {
      const r = step(states, zones, present ? [SITTING] : [PASSING], sec * 1000, T);
      states = r.states;
      events.push(...r.events);
    }
  }
  return { states, events };
}

const appt = (id: string, time: string, doctorId = 'd1', status = 'Confirmed', duration = 30): Appointment =>
  ({ id, patientId: `p-${id}`, patientName: `Bemor ${id}`, doctorId, doctorName: 'Rustamov', type: 'Konsultatsiya', date: '2026-10-10', time, duration, status, notes: null });
const sit = (id: string, startMin: number, endMin: number | null, doctorId: string | null = 'd1'): Sitting => ({ id, doctorId, label: 'Kabinet 1', startMin, endMin });

export function cameraLogicTests(ok: Ok): void {
  console.log('\n# Kamera: zonadagi seanslar');
  ok('kamera: markazi zonada bo\'lgan odam — zonada', inZone(SITTING, CHAIR) && !inZone(PASSING, CHAIR));

  const brief = play([[0, 6, true], [8, 40, false]]);
  ok("kamera: o'tib ketgan odam seans emas", brief.events.length === 0 && !brief.states.z1.open);

  const sat = play([[0, 30, true]]);
  ok('kamera: 20 soniya turgan odam — seans boshlandi', sat.events.length === 1 && sat.events[0].type === 'start', JSON.stringify(sat.events));
  ok("kamera: seans boshi — birinchi ko'ringan payt", sat.events[0]?.at === 0);

  const blink = play([[0, 24, true], [26, 50, false], [52, 80, true]]);
  ok("kamera: bir zum ko'rinmay qolish seansni uzmaydi", blink.events.filter(e => e.type === 'end').length === 0 && blink.states.z1.open);

  const left = play([[0, 100, true], [102, 170, false]]);
  const end = left.events.find(e => e.type === 'end');
  ok('kamera: bir daqiqa yo\'q bo\'lsa — seans tugadi', !!end && !left.states.z1.open, JSON.stringify(left.events));
  ok("kamera: seans oxiri — oxirgi ko'ringan payt", end?.at === 100_000);

  const twice = play([[0, 2, true], [4, 14, false], [16, 24, true]]);
  ok("kamera: ikki marta o'tib ketish bitta uzun o'tirish emas", twice.events.length === 0, JSON.stringify(twice.events));

  ok('kamera: kadr uzilsa ochiq seans oxirgi ko\'rilgan paytda yopiladi', flush(sat.states).length === 1 && flush(sat.states)[0].at === 30_000 && flush(brief.states).length === 0);
  ok("kamera: berilgan holat o'zgartirilmaydi", (() => { const before: States = Object.freeze({ z1: Object.freeze({ since: 0, lastSeen: 0, open: false }) }); const r = step(before, [CHAIR], [SITTING], 30_000, T); return before.z1.lastSeen === 0 && r.states.z1.lastSeen === 30_000; })());

  console.log('\n# Kamera: CRM bilan solishtirish');
  const covered = new Map([['d1', { fromMin: 0, toMin: 24 * 60 }]]);
  const fine = reconcile([sit('s1', 10 * 60 + 5, 10 * 60 + 35)], [appt('a1', '10:00')], 12 * 60, covered);
  ok('solishtirish: vaqti mos seans qabulga bog\'lanadi', fine.matched.length === 1 && !fine.ghosts.length && !fine.missed.length);

  const ghost = reconcile([sit('s1', 11 * 60 + 10, 11 * 60 + 45)], [appt('a1', '09:00')], 12 * 60, covered);
  ok("solishtirish: CRM'da yo'q o'tirish — alohida chiqadi", ghost.ghosts.length === 1 && ghost.missed.length === 1);
  ok("solishtirish: farq matni kabinet va vaqtni aytadi", findings(ghost)[0].level === 'crit' && findings(ghost)[0].text.includes('Kabinet 1: 11:10–11:45'), findings(ghost)[0].text);

  const marked = reconcile([], [appt('a1', '09:00', 'd1', 'Completed')], 12 * 60, covered);
  ok("solishtirish: «keldi» deb belgilangan, lekin ko'rinmagan qabul — jiddiy", findings(marked)[0].level === 'crit' && findings(marked)[0].text.includes('«keldi»'));

  const cancelled = reconcile([], [appt('a1', '09:00', 'd1', 'Cancelled'), appt('a2', '09:30', 'd1', 'No-Show')], 12 * 60, covered);
  ok("solishtirish: bekor qilingan va kelmagan qabul farq emas", !cancelled.missed.length);

  const future = reconcile([], [appt('a1', '11:45')], 12 * 60, covered);
  ok("solishtirish: hali vaqti o'tmagan qabul «ko'rinmadi» emas", !future.missed.length);

  const blind = reconcile([], [appt('a1', '09:00', 'd2')], 12 * 60, covered);
  ok("solishtirish: kamerasi yo'q kabinet haqida hech narsa deyilmaydi", !blind.missed.length);

  const other = reconcile([sit('s1', 10 * 60, 10 * 60 + 30, 'd2')], [appt('a1', '10:00', 'd1')], 12 * 60, covered);
  ok("solishtirish: boshqa shifokorning kreslosi o'zga qabulga bog'lanmaydi", other.ghosts.length === 1);

  const two = reconcile([sit('s1', 10 * 60 + 2, 10 * 60 + 30), sit('s2', 10 * 60 + 31, 11 * 60)], [appt('a1', '10:00'), appt('a2', '10:30')], 12 * 60, covered);
  ok("solishtirish: bitta qabul ikki marta bog'lanmaydi", two.matched.length === 2 && new Set(two.matched.map(m => m.appointment.id)).size === 2);

  const sittingNow = reconcile([sit('s1', 11 * 60 + 50, null)], [], 12 * 60, covered);
  ok("solishtirish: hozir o'tirgan bemor «dan beri» deb aytiladi", findings(sittingNow)[0].text.includes('11:50 dan beri'), findings(sittingNow)[0].text);

  const late = reconcile([], [appt('a1', '09:00')], 12 * 60, new Map([['d1', { fromMin: 9 * 60 + 10, toMin: 12 * 60 }]]));
  ok("solishtirish: kamera qabuldan keyin yoqilgan bo'lsa «ko'rinmadi» deyilmaydi", !late.missed.length);
  const died = reconcile([], [appt('a1', '11:00')], 14 * 60, new Map([['d1', { fromMin: 8 * 60, toMin: 11 * 60 + 5 }]]));
  ok("solishtirish: kamera qabul paytida o'chgan bo'lsa «ko'rinmadi» deyilmaydi", !died.missed.length);

  const unbound = reconcile([sit('s0', 10 * 60, 10 * 60 + 20, null), sit('s1', 10 * 60 + 2, 10 * 60 + 30)], [appt('a1', '10:00')], 12 * 60, covered);
  ok("solishtirish: shifokori belgilanmagan kreslo birovning qabulini olib qo'ymaydi", unbound.matched.length === 1 && unbound.matched[0].sitting.id === 's1' && unbound.ghosts[0]?.id === 's0', JSON.stringify(unbound.ghosts));

  const back = reconcile([sit('s1', 10 * 60 + 2, 10 * 60 + 12), sit('s2', 10 * 60 + 16, 10 * 60 + 30)], [appt('a1', '10:00')], 12 * 60, covered);
  ok("solishtirish: kreslodan turib qaytgan bemor yangi bemor emas", back.matched.length === 2 && !back.ghosts.length);

}

/** Kamera va ovozli agent yo'llari: haqiqiy server, soxta DentaCRM */
export async function cameraApiTests(h: Harness): Promise<void> {
  const { ok, api, token, otherToken } = h;
  console.log("\n# Kamera va ovozli agent: yo'llar");
  ok('kamera: kirishsiz — 401', (await api('/api/cameras')).status === 401);
  const made = await api('/api/cameras', { token, body: { name: 'Kabinet 1' } });
  const id = made.json.camera?.id as string;
  ok("kamera: qo'shildi", made.status === 200 && !!id, JSON.stringify(made.json));
  ok("kamera: bo'sh nom — 400", (await api('/api/cameras', { token, body: { name: '  ' } })).status === 400);

  const zone = { kind: 'chair', name: 'Kreslo 1', x: 0.4, y: 0.4, w: 0.2, h: 0.2, doctorId: 'd1' };
  const zoned = await api(`/api/cameras/${id}/zones`, { method: 'PUT', token, body: { zones: [zone] } });
  ok('kamera: zona saqlandi', zoned.status === 200 && zoned.json.camera?.zones?.length === 1 && !!zoned.json.camera.zones[0].id, JSON.stringify(zoned.json));
  ok('kamera: kadrdan tashqaridagi zona — 400', (await api(`/api/cameras/${id}/zones`, { method: 'PUT', token, body: { zones: [{ ...zone, x: 0.9, w: 0.5 }] } })).status === 400);
  ok("kamera: begona biznes zonani o'zgartira olmaydi", (await api(`/api/cameras/${id}/zones`, { method: 'PUT', token: otherToken, body: { zones: [] } })).status === 404);

  const zoneId = zoned.json.camera.zones[0].id as string;
  const seen = await api(`/api/cameras/${id}/observe`, { token, body: { people: [{ x: 0.45, y: 0.42, w: 0.1, h: 0.16 }] } });
  ok("kamera: zonadagi odam — «kiryapti» (hali seans emas)", seen.status === 200 && seen.json.zones?.[zoneId] === 'entering', JSON.stringify(seen.json));
  ok("kamera: buzuq kuzatuv — 400", (await api(`/api/cameras/${id}/observe`, { token, body: { people: [{ x: 2, y: 0, w: 1, h: 1 }] } })).status === 400);
  ok("kamera: begona biznes kuzatuv yubora olmaydi", (await api(`/api/cameras/${id}/observe`, { token: otherToken, body: { people: [] } })).status === 404);

  const sum = await api('/api/cameras/summary', { token });
  ok("kamera: seans boshlanmaguncha hisobda hech kim yo'q, CRM raqamlari bor", sum.status === 200 && sum.json.summary?.seated === 0 && sum.json.summary.sessions.length === 0 && typeof sum.json.summary?.crm?.visits === 'number', JSON.stringify(sum.json).slice(0, 200));

  // Sinov muhitida chegaralar soniyalarda: 1 s tursa — seans, 2 s ko'rinmasa — tugaydi
  const person = { people: [{ x: 0.45, y: 0.42, w: 0.1, h: 0.16 }] };
  // Dvigatel kadrlarni tez-tez yuboradi: siyrak kelsa, zonaga kirish payqalmaydi
  for (let i = 0; i < 4; i++) { await sleep(300); await api(`/api/cameras/${id}/observe`, { token, body: person }); }
  const opened = await api(`/api/cameras/${id}/observe`, { token, body: person });
  ok("kamera: yetarlicha turgan odam — seans ochildi", opened.json.zones?.[zoneId] === 'open', JSON.stringify(opened.json));
  const renamed = await api(`/api/cameras/${id}/zones`, { method: 'PUT', token, body: { zones: [{ ...zone, id: zoneId, name: 'Kreslo A', doctorId: 'd9' }] } });
  ok("kamera: zona nomini o'zgartirish idni saqlaydi", renamed.json.camera?.zones?.[0]?.id === zoneId, JSON.stringify(renamed.json));
  const still = await api(`/api/cameras/${id}/observe`, { token, body: person });
  ok("kamera: nom o'zgarsa o'tirgan bemorning seansi uzilmaydi", still.json.zones?.[zoneId] === 'open', JSON.stringify(still.json));
  const during = (await api('/api/cameras/summary', { token })).json.summary;
  ok("kamera: ochiq seans hisobda bitta bo'lib ko'rinadi", during?.sessions?.length === 1 && during.sessions[0].endedAt === null, JSON.stringify(during?.sessions));
  const foreignId = await api(`/api/cameras/${id}/zones`, { method: 'PUT', token, body: { zones: [{ ...zone, id: zoneId, name: 'Kreslo A', doctorId: 'd9' }, { ...zone, id: zoneId, kind: 'desk', name: 'Kassa', x: 0.1, y: 0.1 }] } });
  ok("kamera: bir xil id ikki zonaga berilmaydi", new Set(foreignId.json.camera?.zones?.map((z: { id: string }) => z.id)).size === 2, JSON.stringify(foreignId.json.camera?.zones));
  await api(`/api/cameras/${id}/observe`, { token, body: { people: [] } });
  await sleep(2300);
  const left = await api(`/api/cameras/${id}/observe`, { token, body: { people: [] } });
  const after = (await api('/api/cameras/summary', { token })).json.summary;
  ok("kamera: ko'rinmay qolsa — seans yopildi", left.json.zones?.[zoneId] === 'empty' && after?.sessions?.length === 1 && !!after.sessions[0].endedAt, JSON.stringify(after?.sessions));
  ok("kamera: yopilgan o'tirish «kresloga o'tirdi» deb sanaladi", after?.seated === 1, String(after?.seated));
  ok("kamera: CRM'da yo'q o'tirish farq bo'lib chiqadi", !!after?.findings?.some((f: { level: string; text: string }) => f.level === 'crit' && f.text.includes('Kreslo 1')), JSON.stringify(after?.findings));
  ok("kamera: kamera qabul vaqtida ishlamagan bo'lsa «ko'rinmadi» deyilmaydi", !after?.findings?.some((f: { text: string }) => f.text.includes("ko'rinmadi")), JSON.stringify(after?.findings));
  ok("kamera: noto'g'ri sana — 400", (await api('/api/cameras/summary?date=2026-13-99', { token })).status === 400);

  ok('ovoz: kalit hali yaratilmagan', (await api('/api/voice/key', { token })).json.exists === false);
  const key = (await api('/api/voice/key', { token, body: {} })).json.key as string;
  ok('ovoz: kalit yaratildi', typeof key === 'string' && key.includes('.') && (await api('/api/voice/key', { token })).json.exists === true);

  ok("ovoz: kalitsiz — 401", (await api('/api/voice/slots')).status === 401);
  ok("ovoz: buzilgan kalit — 401", (await api('/api/voice/slots', { token: key.slice(0, -2) + 'xx' })).status === 401);
  ok("ovoz: panel kaliti bilan agent yo'liga kirib bo'lmaydi", (await api('/api/voice/slots', { token })).status === 401);
  const slots = await api('/api/voice/slots', { token: key });
  ok("ovoz: bo'sh vaqtlar matni keladi", slots.status === 200 && typeof slots.json.schedule === 'string' && slots.json.schedule.length > 20, JSON.stringify(slots.json).slice(0, 160));
  const noName = await api('/api/voice/book', { token: key, body: { doctorId: 'd1', date: '2026-10-12', time: '10:00', name: 'Bobur', phone: '901234567' } });
  ok("ovoz: familiyasiz qabulga yozilmaydi", noName.status === 409 && noName.json.code === 'unavailable' && !JSON.stringify(noName.json).includes('Bemor'), JSON.stringify(noName.json));
  const call = await api('/api/voice/calls', { token: key, body: { phone: '+998901234567', name: 'Bobur Karimov', startedAt: '2020-01-01T10:00:00+05:00', durationSec: 24, outcome: "Narx so'radi", transcript: [{ who: 'ai', text: 'Assalomu alaykum' }, { who: 'caller', text: 'Implant qancha?' }] } });
  ok("ovoz: tugagan qo'ng'iroq saqlanadi", call.status === 200 && !!call.json.call?.id, JSON.stringify(call.json));
  ok("ovoz: buzuq qo'ng'iroq — 400", (await api('/api/voice/calls', { token: key, body: { phone: '', durationSec: -1, outcome: '', transcript: 'x' } })).status === 400);
  const listed = await api('/api/calls', { token });
  ok("ovoz: qo'ng'iroq panelda ko'rinadi", listed.json.calls?.[0]?.name === 'Bobur Karimov' && listed.json.calls[0].transcript.length === 2);
  ok("ovoz: begona biznes bu qo'ng'iroqni ko'rmaydi", ((await api('/api/calls', { token: otherToken })).json.calls ?? []).length === 0);

  const key2 = (await api('/api/voice/key', { token, body: {} })).json.key as string;
  ok("ovoz: yangi kalit yaratilsa eskisi ishlamaydi", (await api('/api/voice/slots', { token: key })).status === 401 && (await api('/api/voice/slots', { token: key2 })).status === 200);
  ok("ovoz: agent aytgan eski sana qabul qilinmaydi (server vaqti qo'yiladi)", String(listed.json.calls?.[0]?.startedAt).slice(0, 4) !== '2020');

  ok("kamera: o'chirildi", (await api(`/api/cameras/${id}`, { method: 'DELETE', token })).status === 200 && (await api('/api/cameras', { token })).json.cameras.length === 0);
}

/** Suhbatdagi "bo'limni och" buyruqlari (panel ularni yordamchiga yubormaydi) */
export function commandTests(ok: Ok): void {
  console.log("\n# Suhbat: bo'limni ochish buyruqlari");
  ok("buyruq: «Kassa kamerasini och» — kameralar", sectionFor('Kassa kamerasini och') === 'cameras');
  ok("buyruq: «Qo'ng'iroqlarni ko'rsat» — qo'ng'iroqlar", sectionFor("Qo'ng'iroqlarni ko'rsat") === 'calls');
  ok('buyruq: ruscha «Открой камеры» ham tushuniladi', sectionFor('Открой камеры') === 'cameras');
  ok("buyruq: fe'lsiz gap buyruq emas", sectionFor('Kameralar nima ko‘rdi?') === null && sectionFor('Kim qo‘ng‘iroq qildi?') === null);
  ok("buyruq: uzun topshiriq yordamchiga ketadi", sectionFor("Aliyevga 20 ta stol uchun hujjat tayyorlab ko'rsat") === null);
  ok("buyruq: «ochiq» so'zi «och» emas", sectionFor('Kamera ochiq qoldi') === null);
}

/** Yordamchining kamera asbobi: haqiqiy server, soxta Claude va soxta DentaCRM */
export async function cameraToolTests(h: Harness): Promise<void> {
  const { ok, api, token } = h;
  console.log('\n# Kamera: yordamchi asbobi');
  const before = ai.requests.length;
  const r = await api('/api/chat', { token, body: { text: 'kamera hisobi {}' } });
  const last = ai.requests.slice(before).filter(q => q.system.includes('Name: Mebel Uyi')).at(-1)?.messages.at(-1)?.content;
  const block = Array.isArray(last) ? last.find(b => b.type === 'tool_result') : undefined;
  let result: { cameras?: number; seated_in_chair?: number; findings?: unknown; crm?: unknown } = {};
  try { result = JSON.parse(String(block?.content)); } catch { /* xato matni */ }
  ok('clinic_cameras: yordamchi kamera hisobini oladi', r.status === 200 && !block?.is_error && typeof result.seated_in_chair === 'number' && Array.isArray(result.findings), JSON.stringify(block ?? r.json).slice(0, 220));
  ok("clinic_cameras: kamera yo'qligi ochiq aytiladi (cameras: 0)", result.cameras === 0, JSON.stringify(result));
}

/** Jurnal: qo'ng'iroq, kamera va yozishmalardan bitta ro'yxat */
export function journalTests(ok: Ok): void {
  console.log('\n# Jurnal');
  const at = (h: number, m: number) => new Date(2026, 9, 12, h, m).toISOString();
  const call = (id: string, startedAt: string, booked: string | null = null) => ({ id, phone: '+998901112233', name: id === 'c2' ? null : 'Bobur Karimov', startedAt, durationSec: 30, outcome: "Narx so'radi", transcript: [], booked });
  const summary = {
    date: '2026-10-12', seated: 1, deskVisits: 0, crm: null,
    findings: [{ level: 'crit' as const, text: "Kabinet 1: 11:10–11:45 da kresloda bemor bor edi, CRM'da bunday qabul yo'q." }, { level: 'ok' as const, text: 'Hammasi mos' }],
    sessions: [{ id: 's1', cameraId: 'k1', zoneId: 'z1', kind: 'chair' as const, zoneName: 'Kreslo 1', startedAt: at(11, 10), endedAt: null }],
  };
  const lead = (id: string, name: string) => ({ id, name }) as unknown as import('../src/types').Lead;
  const threads = [{ lead: lead('l1', 'Dilnoza'), last: null, pending: 2 }, { lead: lead('l2', 'Sardor'), last: null, pending: 0 }];
  const j = buildJournal([call('c1', at(9, 0), 'dushanba 15:30'), call('c2', at(12, 30)), call('c3', new Date(2026, 9, 11, 18, 0).toISOString())], summary, threads, '2026-10-12');
  ok("jurnal: kutayotganlar — kamera farqi va tasdiq kutayotgan yozishma (mos kelgani va javobsizi emas)", j.waiting.length === 2 && j.waiting[0].level === 'crit' && j.waiting[1].text.includes('Dilnoza: 2 ta'), JSON.stringify(j.waiting.map(w => w.text)));
  ok('jurnal: bugungi ishlar yangisi yuqorida, kechagi kirmaydi', j.today.map(t => t.key).join() === 'cc2,ss1,cc1', j.today.map(t => t.key).join());
  ok("jurnal: ismsiz qo'ng'iroq raqami bilan, qabul yozilgani bilan ko'rinadi", j.today[0].text.startsWith('+998901112233') && j.today[2].text.includes('dushanba 15:30'));
  ok("jurnal: hali o'tirgan bemor shunday deb aytiladi, qator o'z bo'limiga olib boradi", j.today[1].text.includes('hozir ham') && j.today[1].page === 'cameras' && j.today[0].page === 'calls');
  ok("jurnal: kamera hisobi yo'q bo'lsa ham ishlaydi", buildJournal([], null, [], '2026-10-12').today.length === 0);
}
