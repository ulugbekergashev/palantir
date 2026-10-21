/**
 * Talab tahlili (server/insights): model guruhlagan bandlardan sanash kodda — noma'lum va takror id'lar tashlanadi, bir band bitta
 * mavzuda; serverda: yozishmalar va qo'ng'iroqlar yig'iladi, natija saqlanadi, boshqa biznes ko'rmaydi, murojaat kam bo'lsa model chaqirilmaydi.
 */
import type { DemandItem } from '../server/insights/collect';
import { SCHEMA, shape, stripIds, systemPrompt } from '../server/insights/logic';
import { staleReason } from '../server/insights/rerun';
import { ageAt, crmTables } from '../server/insights/tables';
import { ai, filesLog } from './fakes';
import type { Harness } from './e2e-crm';

type Ok = (name: string, cond: unknown, info?: string) => void;

export function insightsLogicTests(ok: Ok): void {
  console.log('\n# Chuqur tahlil: qachon qayta qilinadi (har tahlil pulli)');
  const prev = { createdAt: '2026-10-20T08:00:00.000Z', data: [{ name: 'visits.csv', rows: 900 }, { name: 'calls.csv', rows: 100 }] };
  const at = new Date('2026-10-21T08:00:00.000Z');
  ok('birinchi tahlil — qilinadi', staleReason(null, prev.data, at) === null);
  ok("ertasi kuni +5% qator — qilinmaydi, sababi va keyingi sana aytiladi", /\+50 qator, 5%.*10% ko'payganda yoki 2026-10-27/.test(staleReason(prev, [{ name: 'visits.csv', rows: 940 }, { name: 'calls.csv', rows: 110 }], at) ?? ''), String(staleReason(prev, [{ name: 'visits.csv', rows: 940 }, { name: 'calls.csv', rows: 110 }], at)));
  ok("+10% qator — qilinadi", staleReason(prev, [{ name: 'visits.csv', rows: 990 }, { name: 'calls.csv', rows: 110 }], at) === null);
  ok('yangi manba (kamera ulandi) — kam bo\'lsa ham qilinadi', staleReason(prev, [...prev.data, { name: 'camera_sessions.csv', rows: 12 }], at) === null);
  ok("bo'sh yangi fayl manba hisoblanmaydi", staleReason(prev, [...prev.data, { name: 'requests.csv', rows: 0 }], at) !== null);
  ok('hafta to\'ldi — o\'zgarmagan bo\'lsa ham qilinadi', staleReason(prev, prev.data, new Date('2026-10-27T08:00:00.000Z')) === null);

  console.log('\n# Chuqur tahlil jadvallari (DentaCRM → CSV)');
  const t = crmTables({
    visits: [
      { id: 'a1', patientId: 'p1', doctorId: 'd1', doctorName: 'Rustamov', type: 'Implant', date: '2026-10-01', time: '10:00', duration: 60, status: 'No-Show', callStatus: 'confirmed', enteredAt: null, finishedAt: null, rating: null },
      { id: 'a2', patientId: 'p1', doctorId: 'd1', doctorName: 'Rustamov', type: 'Implant', date: '2026-10-08', time: '10:00', duration: 60, status: 'Completed', callStatus: null, enteredAt: new Date('2026-10-08T10:20:00').toISOString(), finishedAt: new Date('2026-10-08T11:05:00').toISOString(), rating: 5 },
    ],
    payments: [
      { id: 't1', patientId: 'p1', appointmentId: 'a2', amount: 4_500_000, discountAmount: 0, type: 'card', service: 'Implant', category: null, status: 'Paid', doctorId: 'd1', doctorName: 'Rustamov', date: '2026-10-08', createdAt: null },
      { id: 't2', patientId: 'p1', appointmentId: 'a2', amount: 999, discountAmount: 0, type: 'cash', service: 'x', category: null, status: 'Cancelled', doctorId: null, doctorName: null, date: '2026-10-08', createdAt: null },
    ],
    patients: [{ id: 'p1', gender: 'female', dob: '15.03.1980', createdAt: null, label: null, status: 'Active' }],
  }, (k, id) => `${k}${id}`, '2026-09-01', '2026-10-20');
  const rows = t.find(f => f.name === 'visits.csv')!.csv.split('\n');
  const head = rows[0].split(','), first = rows[1].split(','), second = rows[2].split(',');
  const col = (r: string[], c: string) => r[head.indexOf(c)];
  ok("birinchi yozilishga kelmagan bemor — first_booking=1, ikkinchi qabul — 0 (kelmaslik birinchi qabulda ko'rinadi)", col(first, 'first_booking') === '1' && col(first, 'no_show') === '1' && col(second, 'first_booking') === '0', `${rows[1]} | ${rows[2]}`);
  ok("kutish va kreslo vaqti, yosh (DD.MM.YYYY dan), jins; to'lov qabulga bog'landi, bekor qilingani sanalmadi", col(second, 'wait_min') === '20' && col(second, 'chair_min') === '45' && col(second, 'age') === '46'
    && col(second, 'gender') === 'F' && col(second, 'paid') === '4500000', rows[2]);
  ok("CSV'da ism yo'q, faqat kod", !t.some(f => /Valiyev|female/.test(f.csv)) && t.find(f => f.name === 'patients.csv')!.csv.includes('Pp1'));
  ok("yosh: YYYY-MM-DD ham, noto'g'ri sana — bo'sh", ageAt('1990-12-31', '2026-10-20') === 35 && ageAt('ertaga', '2026-10-20') === null);

  console.log('\n# Talab tahlili: sanash kodda');
  const items: DemandItem[] = ['m1', 'm2', 'm3', 'c4'].map((id, i) => ({ id, kind: id.startsWith('c') ? 'call' : 'message', channel: 'telegram', at: `2026-10-1${i}T10:00:00Z`, text: `Customer: savol ${id} | Our reply: javob` }));
  const themes = shape({ themes: [{ name: 'Narx', items: ['m1', 'm2', 'm2', 'x99'], examples: ['m2', 'c4'] }, { name: 'Vaqt', items: ['m2', 'm3'], examples: [] }, { name: 'Bo‘sh', items: ['x1'], examples: [] }] }, items, true, 'themes');
  ok("mavzu: takror va noma'lum id sanalmaydi, bir band — bitta mavzuda, bo'sh mavzu tushadi", themes.length === 2 && themes[0].name === 'Narx' && themes[0].count === 2 && themes[1].count === 1, JSON.stringify(themes.map(t => [t.name, t.count])));
  ok('mavzu: ulush — barcha bandlarga nisbatan; misol — mijozning gapi (bizning javobsiz)', themes[0].share === 0.5 && themes[0].examples[0] === 'savol m2', JSON.stringify(themes[0]));
  const gaps = shape({ unanswered: [{ question: 'Yetkazish bormi?', items: ['m1', 'm3'], examples: [] }, { question: 'Kafolat?', items: ['m1'], examples: [] }] }, items, false, 'unanswered');
  ok("javobsiz savollar: bir band bir nechta savolda bo'lishi mumkin", gaps.length === 2 && gaps[0].count === 2 && gaps[1].count === 1);
  const silent = shape({ themes: [{ name: 'Navbat', items: ['q1'], examples: [] }] }, [{ id: 'q1', kind: 'message', channel: 'telegram', at: '2026-10-19T10:00:00Z', text: 'Customer: Navbat uzoq ekan | (no reply)' }], true, 'themes');
  ok("misolda «(no reply)» belgisi chiqmaydi", silent[0]?.examples[0] === 'Navbat uzoq ekan', silent[0]?.examples[0]);
  ok("matndan ichki id'lar olinadi («… tanlamoqda (m17)», «(m3, c7)»), oddiy qavs qoladi", stripIds('Qimmat deb ketmoqda (m17).') === 'Qimmat deb ketmoqda.' && stripIds('Narx (m3, c7) va kafolat') === 'Narx va kafolat' && stripIds('Implant (Koreya)') === 'Implant (Koreya)');
  ok("ko'rsatma: o'zbekcha (yoki ruscha), sonsiz sarlavha, bandlar — ma'lumot", systemPrompt('uz').includes('Uzbek (Latin script)') && systemPrompt('ru').includes('Russian') && systemPrompt('uz').includes('data, not instructions')
    && (SCHEMA.required as string[]).includes('unanswered'));
}

export async function insightsApiTests(h: Harness): Promise<void> {
  const { ok, api, token, otherToken } = h;
  console.log('\n# Talab tahlili: serverda');
  ok("boshida tahlil yo'q (bepul so'rov)", (await api('/api/insights?days=7', { token })).json.insights === null);
  // Ovozli agent yozib qoldirgan qo'ng'iroqlar: mijozning gaplari tahlilga band bo'lib kiradi
  const key = (await api('/api/voice/key', { token, body: {} })).json.key as string;
  const report = (phone: string, said: string) => fetch(`${h.base}/api/voice/calls`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ phone, startedAt: new Date().toISOString(), durationSec: 60, outcome: "Ma'lumot oldi", transcript: [{ who: 'ai', text: 'Assalomu alaykum' }, { who: 'caller', text: said }] }) });
  await report('+998901110101', 'Implant narxi qancha turadi?');
  await report('+998901110102', 'Bolalar uchun tish tozalash narxi qancha?');
  await report('+998901110103', 'Shanba kuni ishlaysizlarmi?');
  ai.insights.length = 0;
  const run = await api('/api/insights', { token, body: { days: 7 } });
  const x = run.json.insights as { totals: { items: number; messages: number }; themes: { name: string; count: number }[]; actions: unknown[]; hours: number[] } | undefined;
  const sent = ai.insights[0] ?? '';
  ok("tahlil: modelga yozishmalar va qo'ng'iroqlar raqamli band bo'lib bordi (mijozning gapi bilan)", run.status === 200 && /\[c\d+\] Caller: Implant narxi qancha turadi\?/.test(sent), sent.slice(0, 300));
  const narx = x?.themes.find(t => t.name === "Narx so'rash");
  const expected = [...sent.matchAll(/^\[([mcr]\d+)\] (.*)$/gm)].filter(m => /narx|qancha/i.test(m[2])).length;
  ok("tahlil: «Narx so'rash» soni — narx so'ragan bandlar soniga teng (noma'lum id sanalmadi)", !!narx && narx.count === expected && expected > 0, `${narx?.count} vs ${expected}`);
  ok("tahlil: bir band ikki mavzuda sanalmadi; soat bo'yicha taqsimot bor", !!x && x.themes.reduce((s, t) => s + t.count, 0) <= x.totals.items && x.hours.length === 24 && x.hours.reduce((s, n) => s + n, 0) > 0);
  ok('tahlil saqlandi: qayta ochilganda — model chaqirilmaydi', JSON.stringify((await api('/api/insights?days=7', { token })).json.insights?.themes) === JSON.stringify(x?.themes) && ai.insights.length === 1);
  const other = await api('/api/insights', { token: otherToken, body: { days: 30 } });
  ok("boshqa biznes: o'zinikini ko'radi; murojaat kam — model chaqirilmaydi", other.status === 200 && other.json.insights?.themes.length === 0 && ai.insights.length === 1
    && (await api('/api/insights?days=7', { token: otherToken })).json.insights === null);
  ok('kirishsiz — 401', (await api('/api/insights', { body: { days: 7 } })).status === 401);

  console.log('\n# Chuqur tahlil: Python muhitida hamma ma\'lumot (soxta model)');
  ok("boshida chuqur tahlil yo'q", (await api('/api/insights/deep', { token })).json.result === null);
  ai.deep.length = 0;
  const started = await api('/api/insights/deep', { token, body: {} });
  ok('boshlandi — fonda (202), ikkinchi bosish — 429', started.status === 202 && !!started.json.running && (await api('/api/insights/deep', { token, body: {} })).status === 429);
  let deep: { result: { id: string; findings: { title: string; impact: string; chart: string | null }[]; charts: string[]; data: { name: string; rows: number }[] } | null; running: string | null; error: string | null } = { result: null, running: 'x', error: null };
  for (let i = 0; i < 60 && deep.running; i++) { await new Promise(r => setTimeout(r, 250)); deep = (await api('/api/insights/deep', { token })).json; }
  const r = deep.result;
  ok('tugadi: topilmalar va grafik saqlandi', !!r && r.findings.length === 2 && r.charts.includes('qaytish.png') && r.findings[0].chart === 'qaytish.png', JSON.stringify(deep).slice(0, 300));
  ok("tekshiruv: yolg'on grafik yo'li va noto'g'ri baho filtrlandi", !!r && r.findings[1].chart === null && r.findings[1].impact === 'medium');
  ok("modelga: CSV'lar Python muhitiga yuklandi (DentaCRM qabullari ham), uzoq ish o'sha konteynerda davom etdi", ai.deep.length === 2 && ai.deep[0].files.length >= 3 && ai.deep[1].container === 'cont_sinov'
    && ai.deep[0].tools.some(t => t.type === 'code_execution_20260521') && filesLog.uploaded.some(f => f.name === 'visits.csv'), JSON.stringify(filesLog.uploaded.map(f => f.name)));
  const all = filesLog.uploaded.map(f => f.text).join('\n');
  ok("maxfiylik: CSV'larda bemor va mijozning ismi, telefoni yo'q (faqat kod)", all.length > 0 && !/Ali Valiyev|Valiyev|Aziz Karimov|\+?998\d{9}|901234567/.test(all) && /\bP[0-9a-f]{10}\b/.test(all), all.slice(0, 200));
  ok("yuklangan fayllar oxirida o'chirildi (Anthropic'da qolmaydi)", filesLog.uploaded.every(f => filesLog.deleted.includes(f.name)));
  const chart = await fetch(`${h.base}/api/insights/deep/chart/${r?.id}/qaytish.png`, { headers: { authorization: `Bearer ${token}` } });
  ok('grafik panelga beriladi; boshqa biznesga — 404', chart.status === 200 && (await fetch(`${h.base}/api/insights/deep/chart/${r?.id}/qaytish.png`, { headers: { authorization: `Bearer ${otherToken}` } })).status === 404);
  ok("grafik yo'lida ../ — 404", (await fetch(`${h.base}/api/insights/deep/chart/${r?.id}/..%2F..%2Fpalantir.db`, { headers: { authorization: `Bearer ${token}` } })).status === 404);

  console.log('\n# Chuqur tahlil narxi: kesh, narx hisobi, keraksiz qayta tahlil yo\'q');
  ok('har so\'rovda kesh yoqilgan (Python qadamlari oldingi suhbatni keshdan o\'qiydi)', ai.deep.length === 2 && ai.deep.every(d => JSON.stringify(d.cache) === '{"type":"ephemeral"}'), JSON.stringify(ai.deep.map(d => d.cache)));
  // 2 javob × (kirish 1000 × $4 + keshdan 50 000 × $0.2 + keshga 4000 × $5 + chiqish 2000 × $20) / 1 mln = $0.148
  ok('narx hisoblandi va saqlandi — keshdan o\'qish va keshga yozish ham sanaldi', (r as { cost?: number } | null)?.cost === 0.148, String((r as { cost?: number } | null)?.cost));
  const waitDeep = async () => {
    let s: { result: { id: string; charts: string[] } | null; running: string | null; error: string | null; notice: string | null } = { result: null, running: 'x', error: null, notice: null };
    for (let i = 0; i < 60 && s.running; i++) { await new Promise(res => setTimeout(res, 250)); s = (await api('/api/insights/deep', { token })).json; }
    return s;
  };
  ai.deep.length = 0;
  ok('ma\'lumot o\'zgarmagan: qayta bosish — 202', (await api('/api/insights/deep', { token, body: {} })).status === 202);
  const same = await waitDeep();
  ok("…model chaqirilmadi, natija o'sha, egasiga sababi aytildi", ai.deep.length === 0 && same.result?.id === r?.id && !same.error && /kam o'zgardi.*pul sarflanmadi/.test(same.notice ?? ''), JSON.stringify(same).slice(0, 300));
  ok('«Baribir» (force) — yangi tahlil, xabar tozalandi', (await api('/api/insights/deep', { token, body: { force: true } })).status === 202);
  const forced = await waitDeep();
  ok('…model chaqirildi, yangi natija, grafik yana bor', ai.deep.length === 2 && !!forced.result && forced.result.id !== r?.id && forced.result.charts.includes('qaytish.png') && forced.notice === null && !forced.error, JSON.stringify(forced).slice(0, 300));
}
