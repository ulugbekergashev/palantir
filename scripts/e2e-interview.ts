/**
 * Birinchi kun suhbati sinovlari: Cerebro tayyor savollarni o'zi so'raydi, egasining javoblari darhol bilimga yoziladi.
 * Bu yo'lda model chaqirilmaydi — suhbat ochiq turganda egasining gapi javob deb olinadi.
 */
import type { BrainView } from '../src/types';
import type { Harness } from './e2e-crm';
import { OWNER, ai, press, say, sent, waitFor, type Sent } from './fakes';

const textOf = (s: Sent | undefined) => String(s?.params.text ?? '');
const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();

export async function interviewTests(h: Harness): Promise<void> {
  const { ok, api, token, otherToken } = h;
  console.log("\n# Birinchi kun suhbati: Cerebro tayyor savollarni o'zi so'raydi");
  const brain = async () => (await api('/api/brain', { token })).json.brain as BrainView;
  const chat = async (text: string, as = token) => ((await api('/api/chat', { token: as, body: { text } })).json.entries ?? []) as { role: string; text: string }[];
  const answerOf = async (id: string) => (await brain()).pack.find(q => q.id === id)?.answer ?? null;
  const before = await brain();
  const open = before.pack.filter(q => !q.answer);
  const [first, second, third] = open;

  const calls = ai.requests.length;
  const started = await chat('savollar');
  ok("suhbat: «savollar» deyilsa — birinchi javobsiz savol so'raladi (nechta qolgani, tartib raqami va misol bilan)", open.length >= 4 && started.length === 2 && started[1].text.includes(`${open.length} ta savolim bor`)
    && started[1].text.includes(`${before.pack.findIndex(q => q.id === first.id) + 1}/${before.pack.length}. ${first.question}`) && started[1].text.includes(first.hint), started[1]?.text);
  const doubted = await chat("Nega so'rayapsan?");
  ok("suhbat: savol bilan tugagan gap javob deb yozilmaydi — o'sha savol qayta so'raladi", doubted[1]?.text.includes("savolga o'xshadi") && doubted[1].text.includes(first.question) && !(await answerOf(first.id)), doubted[1]?.text);
  const answered = await chat('Sinov javobi: ha, shunday qilamiz');
  const saved = await answerOf(first.id);
  ok("suhbat: javob darhol bilimga yozildi (shu tayyor savolga bog'lanib), keyingi savol so'raldi", answered[1]?.text.startsWith('✅ Yozib oldim') && answered[1].text.includes(second.question) && saved?.answer === 'Sinov javobi: ha, shunday qilamiz' && saved.source === `pack:${first.id}` && saved.status === 'active', answered[1]?.text);
  const skipped = await chat('Keyingi');
  ok("suhbat: «keyingi» — savol o'tkazib yuboriladi, javob yozilmaydi", skipped[1]?.text.includes(third.question) && !skipped[1].text.includes('Yozib oldim') && !(await answerOf(second.id)), skipped[1]?.text);
  const flagged = await chat('Sinov javobi: 100% natija beramiz');
  ok("suhbat: javobda reklama filtri so'zi bo'lsa — yoziladi va shu zahoti ogohlantiriladi", flagged[1]?.text.includes('⚠️') && flagged[1].text.includes('100%') && (await answerOf(third.id))?.answer.includes('100%'), flagged[1]?.text);
  ok("suhbat: shu vaqt ichida model bir marta ham chaqirilmadi; boshqa biznesning gapi esa yordamchisiga ketadi", ai.requests.length === calls && (await chat('Salom', otherToken))[1]?.text === 'Tushundim: salom');
  const stopped = await chat("To'xta");
  ok("suhbat: «to'xta» — yakun: nechta javob olindi, nechta savol qoldi", stopped[1]?.text.includes('2 ta javob oldim') && stopped[1].text.includes(`${open.length - 2} ta savol javobsiz qoldi`), stopped[1]?.text);
  ok("suhbat: to'xtagach gap yana yordamchiga ketadi", (await chat('Salom'))[1]?.text === 'Tushundim: salom');

  const viaButton = await api('/api/brain/interview', { token, body: { action: 'start' } });
  const resumed = String(viaButton.json.entries?.[0]?.text ?? '');
  ok("suhbat: paneldagi tugma bilan ham boshlanadi — javob berilgan savol qayta so'ralmaydi, o'tkazib yuborilgani yana so'raladi; noto'g'ri amal — 400", viaButton.status === 200 && viaButton.json.open === true && !resumed.includes(first.question) && resumed.includes(second.question)
    && (await api('/api/brain/interview', { token, body: { action: 'boshqa' } })).status === 400, resumed);
  const closed = await api('/api/brain/interview', { token, body: { action: 'stop' } });
  ok("suhbat: tugma bilan to'xtatiladi; ochiq bo'lmagan suhbatni to'xtatish — 409", closed.status === 200 && closed.json.open === false && (await api('/api/brain/interview', { token, body: { action: 'stop' } })).status === 409);

  console.log('\n# Birinchi kun suhbati: Telegram');
  const fromOwner = (mark: number, pred: (s: Sent) => boolean) => sent.slice(mark).find(s => Number(s.params.chat_id) === OWNER && s.method === 'sendMessage' && pred(s));
  let mark = sent.length;
  say(OWNER, '/savollar');
  const q1 = await waitFor('savol', () => fromOwner(mark, s => textOf(s).includes('ta savolim bor')));
  ok("Telegram: /savollar — savol va ikki tugma (o'tkazib yuborish, to'xtatish)", !!q1 && textOf(q1).includes(second.question) && buttons(q1).map(b => b.callback_data).join() === `iv|s:${second.id},iv|x`, JSON.stringify(buttons(q1)));
  mark = sent.length;
  say(OWNER, 'Sinov javobi: Telegramdan yozildi');
  const q2 = await waitFor('keyingi savol', () => fromOwner(mark, s => textOf(s).startsWith('✅ Yozib oldim')));
  ok("Telegram: yozilgan gap javob bo'lib saqlandi, keyingi savol yana tugmalar bilan keldi", !!q2 && buttons(q2).length === 2 && (await answerOf(second.id))?.answer === 'Sinov javobi: Telegramdan yozildi', textOf(q2));
  const staleCall = (from: number) => sent.slice(from).find(s => s.method === 'answerCallbackQuery' && textOf(s).includes('eskirgan'));
  mark = sent.length;
  press(OWNER, buttons(q1)[0]?.callback_data ?? '', q1?.id ?? 0);
  const oldButton = await waitFor('eski savol tugmasi', () => staleCall(mark));
  ok("Telegram: javob berilgan eski savolning tugmasi hozirgi savolni o'tkazib yubormaydi — «eskirgan»", !!oldButton && !fromOwner(mark, () => true));
  mark = sent.length;
  press(OWNER, buttons(q2)[0]?.callback_data ?? '', q2?.id ?? 0);
  const q3 = await waitFor('otkazildi', () => fromOwner(mark, s => /^\d+\/\d+\. /.test(textOf(s))));
  mark = sent.length;
  press(OWNER, 'iv|x', q3?.id ?? 0);
  const end = await waitFor('yakun', () => fromOwner(mark, s => textOf(s).includes("Savollarni to'xtatdim")));
  mark = sent.length;
  press(OWNER, 'iv|x', q3?.id ?? 0);
  const stale = await waitFor('eskirgan', () => staleCall(mark));
  ok("Telegram: «O'tkazib yuborish» keyingi savolni beradi, «To'xtatish» suhbatni yopadi (tugmasiz yakun); yopilgach tugma — «eskirgan»", !!q3 && !textOf(q3).includes('Yozib oldim') && !!end && buttons(end).length === 0 && !!stale, `${textOf(q3)} | ${textOf(end)}`);

  // Boshqa sinovlarga iz qolmasin
  for (const q of (await brain()).pack) if (q.answer?.answer.startsWith('Sinov javobi')) await api(`/api/brain/${q.answer.id}`, { method: 'DELETE', token });
  const after = await brain();
  ok("suhbat sinovlaridan keyin tayyor savollar avvalgi holatida", after.pack.filter(q => q.answer).length === before.pack.filter(q => q.answer).length, JSON.stringify(after.pack.filter(q => q.answer).map(q => q.id)));
}
