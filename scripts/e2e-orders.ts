/**
 * Topshiriqlar sinovi: qoidalar (sof mantiq) va yo'llar — topshiriq saqlash, kamera qoidasi kadrda ishlashi, jurnal, yoqish/o'chirish,
 * begona biznesdan himoya. Gapni topshiriqqa aylantirish (haqiqiy AI) — scripts/check-orders.ts da.
 */
import type { Camera } from '../src/types';
import { conditionHolds, dueAt, dueEvery, inWindow, judge, toSpec, whatHappened } from '../server/orders/logic';
import type { Harness } from './e2e-crm';
import { sent, sleep } from './fakes';

type Ok = Harness['ok'];
const at = (hhmm: string, day = '2026-10-19') => new Date(`${day}T${hhmm}:00`);

export function orderLogicTests(ok: Ok): void {
  console.log('\n# Topshiriqlar: qoidalar');
  ok('topshiriq: oraliq — kunduzi', inWindow('09:00', '18:00', at('12:00')) && !inWindow('09:00', '18:00', at('18:00')));
  ok("topshiriq: oraliq yarim tundan o'tadi", inWindow('21:00', '07:00', at('23:30')) && inWindow('21:00', '07:00', at('06:59')) && !inWindow('21:00', '07:00', at('12:00')));
  ok("topshiriq: oraliq berilmagan — har doim", inWindow(null, null, at('03:00')));
  ok('topshiriq: shartlar', conditionHolds('empty', 0, 1) && !conditionHolds('empty', 1, 1) && conditionHolds('crowd', 5, 5) && !conditionHolds('crowd', 4, 5) && conditionHolds('presence', 1, 1));

  const t0 = 1_000_000;
  const a = judge(undefined, true, t0, 0);
  ok("topshiriq: bir zumlik ko'rinish — xabar yo'q", !a.fire && !!a.next);
  const b = judge(a.next, true, t0 + 11_000, 0);
  ok("topshiriq: 10 soniyadan oshsa — xabar", b.fire);
  const c = judge(b.next, true, t0 + 60_000, 0);
  ok("topshiriq: holat davom etsa — qayta aytilmaydi", !c.fire);
  ok("topshiriq: bir kadrda ko'rinmay qolish holatni uzmaydi", judge(c.next, false, t0 + 61_000, 0).next === c.next);
  ok("topshiriq: 30 soniyadan ko'p bajarilmasa — holat unutiladi", judge(c.next, false, t0 + 91_000, 0).next === undefined);
  // 5 daqiqalik qoida: 3-daqiqada bir kadr o'tib ketsa ham hisob boshidan boshlanmaydi
  let h = judge(undefined, true, t0, 5).next;
  h = judge(h, true, t0 + 178_000, 5).next;
  h = judge(h, false, t0 + 180_000, 5).next;
  h = judge(h, true, t0 + 182_000, 5).next;
  ok("topshiriq: o'tib ketgan kadr 5 daqiqalik hisobni buzmaydi", judge(h, true, t0 + 300_000, 5).fire);
  const d = judge({ since: t0, firedAt: null, lastTrue: t0 }, true, t0 + 4 * 60_000, 5);
  ok("topshiriq: 5 daqiqa sharti — 4 daqiqada hali yo'q", !d.fire);
  ok("topshiriq: 5 daqiqa sharti — 5 daqiqada bor", judge(d.next, true, t0 + 5 * 60_000, 5).fire);
  ok('topshiriq: bir soatdan keyin yana eslatadi', judge({ since: t0, firedAt: t0, lastTrue: t0 + 60 * 60_000 }, true, t0 + 61 * 60_000, 0).fire);
  ok("topshiriq: xabar matni", whatHappened({ kind: 'watch', cameraId: null, zoneId: null, condition: 'empty', people: 1, minutes: 10, from: null, to: null }, 0, 'Qabulxona') === "Qabulxona: 10 daqiqadan beri hech kim yo'q");

  const cams = [{ id: 'cam1', name: 'Qabulxona', zones: [{ id: 'z1', kind: 'desk', name: 'Kassa', x: 0, y: 0, w: 1, h: 1, doctorId: null }] }] as unknown as Camera[];
  const w = toSpec('kuzatuvchi', { kind: 'watch', summary: 'Kechasi odam ko‘rinsa xabar beraman', camera_id: 'cam1', zone_id: 'z9', condition: 'presence', people: 0, minutes: 0, from: '21:00', to: '7:00' }, cams);
  ok("topshiriq: model javobi tekshiriladi (begona zona tashlanadi, 7:00 → 07:00)", w.ok && w.spec.kind === 'watch' && w.spec.zoneId === null && w.spec.to === '07:00' && w.spec.cameraId === 'cam1', JSON.stringify(w));
  const foreign = toSpec('kuzatuvchi', { kind: 'watch', summary: 'x', camera_id: 'begona', zone_id: '', condition: 'crowd', people: 99, minutes: 5, from: '', to: '' }, cams);
  ok("topshiriq: begona kamera — hamma kamera, odam soni chegarada", foreign.ok && foreign.spec.kind === 'watch' && foreign.spec.cameraId === null && foreign.spec.people === 40, JSON.stringify(foreign));
  ok("topshiriq: kamera topshirig'i boshqa xodimga berilmaydi", !toSpec('qabulxona', { kind: 'watch', summary: 'x' }, cams).ok);
  ok("topshiriq: kamera yo'q bo'lsa — savol", !toSpec('kuzatuvchi', { kind: 'look', summary: 'x', look_question: 'Toza mi?' }, []).ok);
  const look = toSpec('kuzatuvchi', { kind: 'look', summary: 'x', camera_id: '', at: '', every_min: 5, from: '', to: '', look_question: 'Stol tartibsizmi?' }, cams);
  ok("topshiriq: AI ko'zi 15 daqiqadan tez qaramaydi", look.ok && look.spec.kind === 'look' && look.spec.everyMin === 15, JSON.stringify(look));
  ok("topshiriq: soati yo'q jadval — savol", !toSpec('yordamchi', { kind: 'schedule', summary: 'x', at: '25:00', days: [] }, []).ok);
  ok("topshiriq: tushunarsiz — egasiga savol", !toSpec('yordamchi', { kind: 'unclear', question_to_owner: 'Qachon?' }, []).ok);

  ok("topshiriq: vaqti keldi", dueAt('20:00', [], null, at('20:00')) && dueAt('20:00', [], null, at('20:10')));
  ok("topshiriq: vaqti kelmadi yoki juda kech", !dueAt('20:00', [], null, at('19:59')) && !dueAt('20:00', [], null, at('20:45')));
  ok("topshiriq: bugun bajarilgan — qayta yo'q", !dueAt('20:00', [], at('20:00').toISOString(), at('20:05')));
  ok('topshiriq: hafta kuni (2026-10-19 — dushanba)', dueAt('09:00', [1], null, at('09:01')) && !dueAt('09:00', [2], null, at('09:01')));
  const every = { kind: 'look' as const, cameraId: null, at: null, days: [], everyMin: 30, from: '09:00', to: '18:00', question: 'q' };
  ok("topshiriq: har 30 daqiqada — vaqti keldi/kelmadi", dueEvery(every, at('10:00').toISOString(), at('10:31')) && !dueEvery(every, at('10:00').toISOString(), at('10:10')));
  ok("topshiriq: oraliqdan tashqarida qaramaydi", !dueEvery(every, null, at('19:00')));
}

export async function orderApiTests(h: Harness): Promise<void> {
  const { ok, api, token, otherToken } = h;
  console.log("\n# Topshiriqlar: yo'llar va kamera qoidasi");
  ok('topshiriq: kirishsiz — 401', (await api('/api/orders?member=yordamchi')).status === 401);
  const standing = await api('/api/orders', { token, body: { member: 'qabulxona', text: 'Chegirma va‘da qilma', spec: { kind: 'standing' }, summary: "Mijozga chegirma va'da qilmayman" } });
  ok("topshiriq: doimiy qoida saqlandi", standing.status === 200 && standing.json.order?.active === true, JSON.stringify(standing.json));
  ok("topshiriq: kamera qoidasi boshqa xodimga — 400", (await api('/api/orders', { token, body: { member: 'yordamchi', text: 'x x x', spec: { kind: 'watch', cameraId: null, zoneId: null, condition: 'presence', people: 1, minutes: 0, from: null, to: null }, summary: 'x x x' } })).status === 400);
  ok("topshiriq: buzuq vaqt — 400", (await api('/api/orders', { token, body: { member: 'yordamchi', text: 'x x x', spec: { kind: 'schedule', at: '24:61', days: [] }, summary: 'x x x' } })).status === 400);

  const cam = (await api('/api/cameras', { token, body: { name: 'Zal' } })).json.camera as Camera;
  ok("topshiriq: begona biznes kamerasiga — 400", (await api('/api/orders', { token: otherToken, body: { member: 'kuzatuvchi', text: 'odam ko‘rinsa', spec: { kind: 'watch', cameraId: cam.id, zoneId: null, condition: 'presence', people: 1, minutes: 0, from: null, to: null }, summary: 'x x x' } })).status === 400);
  const profile = await api(`/api/cameras/${cam.id}/profile`, { method: 'PUT', token, body: { profile: 'Kutish zali. Kechasi hech kim bo‘lmasligi kerak.' } });
  ok('topshiriq: kamera tavsifi saqlandi', profile.status === 200 && profile.json.camera?.profile?.startsWith('Kutish zali'), JSON.stringify(profile.json));
  const watch = await api('/api/orders', { token, body: { member: 'kuzatuvchi', text: "Zalda odam ko'rinsa xabar ber", spec: { kind: 'watch', cameraId: cam.id, zoneId: null, condition: 'presence', people: 1, minutes: 0, from: null, to: null }, summary: "Zalda odam ko'rinsa — xabar beraman" } });
  const orderId = watch.json.order?.id as string;
  ok('topshiriq: kamera qoidasi saqlandi', watch.status === 200 && !!orderId, JSON.stringify(watch.json));
  ok("topshiriq: begona biznes ro'yxatida ko'rinmaydi", ((await api('/api/orders?member=kuzatuvchi', { token: otherToken })).json.orders ?? []).length === 0);

  const before = sent.length;
  const person = { people: [{ x: 0.4, y: 0.3, w: 0.2, h: 0.4 }] };
  // Qoida 10 soniya uzluksiz ko'rinishni kutadi (bir zumlik soya — xabar emas)
  for (let i = 0; i < 13; i++) { await api(`/api/cameras/${cam.id}/observe`, { token, body: person }); await sleep(1000); }
  const tested = await api(`/api/orders/${orderId}/run`, { token, body: {} });
  ok("topshiriq: «hozir tekshirish» — kadrdagi odamlar soni", tested.status === 200 && /1 kishi/.test(tested.json.result ?? ''), JSON.stringify(tested.json));
  const live = await api('/api/cameras/live', { token });
  ok('topshiriq: hozir kamerada 1 odam', live.json.live?.[cam.id]?.people === 1, JSON.stringify(live.json));
  let events: { id: string; title: string; orderId: string; cameraId: string }[] = [];
  for (let i = 0; i < 10 && !events.length; i++) { await sleep(300); events = (await api('/api/agents/kuzatuvchi/events', { token })).json.events ?? []; }
  ok("topshiriq: odam 10 soniya ko'rindi — jurnalda hodisa", events.length === 1 && events[0].orderId === orderId && events[0].cameraId === cam.id && /odam ko'rindi/.test(events[0].title), JSON.stringify(events));
  const told = sent.slice(before).some(m => String(m.params.text ?? '').includes('📷'));
  ok("topshiriq: egasiga Telegram'da aytildi", told, sent.slice(before).map(m => String(m.params.text ?? '').slice(0, 60)).join(' | '));
  for (let i = 0; i < 3; i++) { await api(`/api/cameras/${cam.id}/observe`, { token, body: person }); await sleep(500); }
  ok("topshiriq: holat davom etsa — ikkinchi xabar yo'q", ((await api('/api/agents/kuzatuvchi/events', { token })).json.events ?? []).length === 1);
  // «Sizni kutyapti»: kamera hodisasi va kechikkan ish bosh ekranda; «ko'rdim» — ro'yxatdan tushadi
  const late = (await api('/api/tasks', { token, body: { title: 'Kechikkan sinov ishi', dueAt: '2026-01-01T09:00' } })).json.task;
  const att = (await api('/api/attention', { token })).json.items as { key: string; kind: string; refId: string; title: string }[];
  ok("kutyapti: kamera hodisasi va kechikkan ish ro'yxatda, kamera tepada", att?.[0]?.kind === 'camera' && att.some(i => i.kind === 'camera' && i.refId === events[0].id) && att.some(i => i.kind === 'task' && i.refId === late?.id), JSON.stringify(att?.map(i => i.key)));
  ok("kutyapti: begona biznes ko'rmaydi va «ko'rdim» bosa olmaydi", ((await api('/api/attention', { token: otherToken })).json.items ?? []).every((i: { refId: string }) => i.refId !== events[0].id)
    && (await api(`/api/agents/events/${events[0].id}/seen`, { token: otherToken, body: {} })).status === 404);
  ok("kutyapti: «ko'rdim» — hodisa ro'yxatdan tushdi", (await api(`/api/agents/events/${events[0].id}/seen`, { token, body: {} })).status === 200
    && !((await api('/api/attention', { token })).json.items as { refId: string }[]).some(i => i.refId === events[0].id));
  await api(`/api/tasks/${late.id}`, { method: 'PATCH', token, body: { status: 'done' } });
  ok("topshiriq: begona biznes tavsifni o'zgartira olmaydi", (await api(`/api/cameras/${cam.id}/profile`, { method: 'PUT', token: otherToken, body: { profile: 'x' } })).status === 404);
  ok("topshiriq: begona biznes kameraga savol bera olmaydi", (await api('/api/cameras/ask', { token: otherToken, body: { question: 'Kim bor?', cameraId: cam.id } })).status === 404);
  ok("topshiriq: begona biznes kamera sonini ko'rmaydi", !(await api('/api/cameras/live', { token: otherToken })).json.live?.[cam.id]);
  ok("topshiriq: begona biznes jurnalni ko'rmaydi", ((await api('/api/agents/kuzatuvchi/events', { token: otherToken })).json.events ?? []).length === 0);
  const after = (await api('/api/orders?member=kuzatuvchi', { token })).json.orders?.[0];
  ok("topshiriq: necha marta ishlagani yoziladi", after?.hits === 1 && !!after.lastRunAt, JSON.stringify(after));

  const off = await api(`/api/orders/${orderId}`, { method: 'PATCH', token, body: { active: false } });
  ok("topshiriq: o'chirildi", off.status === 200 && off.json.order?.active === false);
  ok("topshiriq: jurnal kadri yo'q bo'lsa — 404, begona biznesga ham", (await api(`/api/agents/events/${events[0]?.id}/image`, { token })).status === 404 && (await api(`/api/agents/events/${events[0]?.id}/image`, { token: otherToken })).status === 404);
  ok("topshiriq: begona biznes o'chira olmaydi", (await api(`/api/orders/${orderId}`, { method: 'DELETE', token: otherToken })).status === 404);
  ok("topshiriq: o'chirib tashlandi", (await api(`/api/orders/${orderId}`, { method: 'DELETE', token })).status === 200);
  await api(`/api/orders/${standing.json.order.id}`, { method: 'DELETE', token });
  // Kamera o'chirilsa — unga bog'langan topshiriq ham o'chadi
  const tied = await api('/api/orders', { token, body: { member: 'kuzatuvchi', text: 'Zal bo‘sh qolsa ayt', spec: { kind: 'watch', cameraId: cam.id, zoneId: null, condition: 'empty', people: 1, minutes: 10, from: null, to: null }, summary: 'Zal bo‘sh qolsa aytaman' } });
  await api(`/api/cameras/${cam.id}`, { method: 'DELETE', token });
  const gone = ((await api('/api/orders?member=kuzatuvchi', { token })).json.orders ?? []).find((o: { id: string }) => o.id === tied.json.order?.id);
  ok("topshiriq: kamera o'chirilsa topshirig'i ham o'chadi", gone?.active === false, JSON.stringify(gone));
  await api(`/api/orders/${tied.json.order?.id}`, { method: 'DELETE', token });
}
