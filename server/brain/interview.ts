/**
 * Birinchi kun suhbati: Palantir tayyor savollarni (brainPack) birma-bir o'zi so'raydi, egasi oddiy gap yoki ovoz bilan javob beradi.
 * Suhbatni egasi o'zi boshlaydi («savollar») va istagan payt to'xtatadi — shu oraliqda yozgani javob deb olinadi, model ishtirok etmaydi.
 * Javob egasining Palantir'ga aytgan o'z so'zi, shuning uchun tasdiq so'ralmaydi: darhol bilimga yoziladi (manba: pack:<id>).
 * Holat bazada turadi (businesses.interview) — server o'chib yonsa ham suhbat joyidan davom etadi.
 */
import type { PackQuestion } from '../../src/data/brainPack';
import { resetConversation } from '../agent';
import { businesses, type BusinessRow } from '../db';
import { filterOptions, filterWarning, packOf, saveAnswer } from './index';
import { packView } from './logic';
import { vault as knowledge } from './vault';
import { GAP_PREFIX, gapsOf, resolveGap } from '../setup/gaps';

interface State {
  /** Hozir so'ralgan savol (brainPack id) */
  asking: string;
  /** Shu suhbatda o'tkazib yuborilganlar — qayta so'ralmaydi */
  skipped: string[];
  answered: number;
}

export interface InterviewTurn {
  text: string;
  /** Suhbat davom etyapti: keyingi xabar javob deb olinadi */
  open: boolean;
  /** Hozir so'ralgan savol (tugma aynan shu savolga tegishli ekanini bilish uchun) */
  asking?: string;
  /** Tayyor javoblar (bo'shliq savollarida): Telegram'da tugma bo'lib chiqadi */
  options?: string[];
}

/** Suhbatdagi savol: bo'shliq (gaps.ts) yoki tayyor savol */
type Question = PackQuestion & { options?: string[] };

/** Suhbatni boshlaydigan so'z (panel suhbatida va Telegram'da): «savollar», «/savollar» */
export const INTERVIEW_START = /^\/?savollar[.!]?$/i;
const SKIP = /^(keyingi|keyingisi|o'tkaz|o'tkazib yubor|o'tkazib yuborish|bilmayman|skip|дальше|пропусти|пропустить)[.!]?$/i;
const STOP = /^(to'xta|to'xtat|to'xtatish|bas|yetarli|keyin|keyinroq|stop|стоп|хватит|потом)[.!]?$/i;
const MIN_ANSWER_CHARS = 2;
const said = (text: string): string => text.trim().toLowerCase().replace(/[‘’ʻʼ`]/g, "'");

function load(biz: BusinessRow): State | null {
  if (!biz.interview) return null;
  try {
    const s = JSON.parse(biz.interview) as Partial<State>;
    return typeof s.asking === 'string' && Array.isArray(s.skipped) ? { asking: s.asking, skipped: s.skipped.filter(x => typeof x === 'string'), answered: Number(s.answered) || 0 } : null;
  } catch {
    return null;
  }
}
const store = (biz: BusinessRow, state: State | null): void => businesses.update(biz.id, { interview: state ? JSON.stringify(state) : null });

export const interviewing = (biz: BusinessRow): boolean => load(biz) !== null;

/**
 * Suhbat savollari: avval bo'shliqlar (ikki xil narx, yozilmagan manzil yoki ish vaqti), keyin tayyor savollar.
 * left — hali javobi yo'qlari (shu suhbatda o'tkazib yuborilganlarsiz)
 */
function questions(biz: BusinessRow, skipped: string[]): { pack: Question[]; left: Question[]; gaps: number } {
  const fresh = businesses.byId(biz.id) ?? biz;
  const gaps: Question[] = gapsOf(fresh).map(g => ({ id: g.id, question: g.question, hint: g.hint, options: g.options }));
  const view = packView(packOf(fresh), knowledge.list(biz.id, 'qa').filter(k => k.status === 'active'));
  return { pack: [...gaps, ...view], left: [...gaps, ...view.filter(q => !q.answer)].filter(q => !skipped.includes(q.id)), gaps: gaps.length };
}

/** Bo'shliqlar raqamlanmaydi (hal bo'lgan sari ro'yxatdan chiqadi — raqam sakrab ketardi); tayyor savollar — «3/7» */
const ask = (pack: Question[], q: Question, lead: string): InterviewTurn => {
  const ready = pack.filter(p => !p.id.startsWith(GAP_PREFIX));
  const mark = q.id.startsWith(GAP_PREFIX) ? '❓ ' : `${ready.findIndex(p => p.id === q.id) + 1}/${ready.length}. `;
  return { open: true, asking: q.id, ...(q.options?.length ? { options: q.options } : {}), text: `${lead}${mark}${q.question}\n${q.hint}` };
};

function finish(biz: BusinessRow, state: State, lead: string): InterviewTurn {
  store(biz, null);
  // Bilim o'zgardi — yordamchi keyingi suhbatni yangi bilim bilan boshlasin
  resetConversation(biz.id);
  const left = questions(biz, []).left.length;
  return { open: false, text: `${lead}Savollarni to'xtatdim: ${state.answered} ta javob oldim${left ? `, ${left} ta savol javobsiz qoldi — «savollar» deb yozsangiz, davom etamiz` : ' — hammasiga javob berildi'}. Javoblar «Ikkinchi miya»da turibdi, istagan payt o'zgartirasiz.` };
}

function next(biz: BusinessRow, state: State, lead: string): InterviewTurn {
  const { pack, left } = questions(biz, state.skipped);
  if (!left.length) return finish(biz, state, lead);
  store(biz, { ...state, asking: left[0].id });
  return ask(pack, left[0], lead);
}

/** Suhbatni boshlaydi (yoki qaytadan boshlaydi): javobi yo'q birinchi savol so'raladi */
export function interviewStart(biz: BusinessRow): InterviewTurn {
  const { pack, left, gaps } = questions(biz, []);
  if (!left.length) {
    store(biz, null);
    return { open: false, text: "Tayyor savollarning hammasiga javob bergansiz 👍 O'zgartirish kerak bo'lsa — «Ikkinchi miya»da." };
  }
  store(biz, { asking: left[0].id, skipped: [], answered: 0 });
  const what = gaps
    ? `${left.length} ta savolim bor: avval ma'lumotlaringizdagi ${gaps} ta aniq bo'lmagan narsa${left.length > gaps ? `, keyin mijozlar eng ko'p so'raydigan ${left.length - gaps} ta savol` : ''}.`
    : `Mijozlar eng ko'p so'raydigan ${left.length} ta savolim bor.`;
  return ask(pack, left[0], `${what} Javobingizni eslab qolaman va mijozlarga shundan javob beraman. Oddiy yozing yoki ovozli xabar yuboring. Bilmasangiz — «keyingi», tugatish uchun — «to'xta».\n\n`);
}

/** Suhbat paytida egasi yozgan gap: javob, «keyingi» yoki «to'xta». Suhbat ochiq bo'lmasa — null (gap yordamchiga ketadi) */
export function interviewReply(biz: BusinessRow, text: string): InterviewTurn | null {
  const state = load(biz);
  if (!state) return null;
  const word = said(text);
  if (STOP.test(word)) return finish(biz, state, '');
  const { pack } = questions(biz, state.skipped);
  const q = pack.find(p => p.id === state.asking);
  // So'ralgan savol ro'yxatdan chiqib ketgan (soha o'zgargan, bo'shliqni boshqa joyda to'ldirishgan) — keyingisiga o'tiladi
  if (!q) return next(biz, state, "Bu savol endi kerak emas — ma'lumot allaqachon bor. Keyingisi:\n\n");
  if (SKIP.test(word)) return next(biz, { ...state, skipped: [...state.skipped, q.id] }, '');
  const answer = text.trim();
  if (answer.length < MIN_ANSWER_CHARS) return ask(pack, q, "Javob juda qisqa — bir-ikki so'z bilan yozing.\n\n");
  // Savol bilan tugagan gap javob emas: egasi boshqa narsa so'rayapti — bilimga yozib qo'yilmaydi
  if (answer.endsWith('?')) return ask(pack, q, "Bu savolga o'xshadi — men hozir javobingizni kutyapman. Boshqa ish bo'lsa, avval «to'xta» deb yozing.\n\n");
  // Bo'shliq: javob o'z joyiga (narxlar jadvali, «Biznes haqida» sahifasi) yoziladi
  if (q.id.startsWith(GAP_PREFIX)) {
    const done = resolveGap(businesses.byId(biz.id) ?? biz, q.id, answer);
    if (!done) return ask(pack, q, "Javobdan kerakli narsani topa olmadim — namunadagidek yozing.\n\n");
    return next(biz, { ...state, answered: state.answered + 1 }, `✅ ${done}\n\n`);
  }
  const saved = saveAnswer(biz, q.question, answer, `pack:${q.id}`);
  const warning = filterWarning(saved.answer, filterOptions(biz));
  return next(biz, { ...state, answered: state.answered + 1 }, `✅ Yozib oldim.${warning ? `\n⚠️ ${warning}` : ''}\n\n`);
}

/** «O'tkazib yuborish» tugmasi. questionId berilsa — faqat o'sha savol hali so'ralayotgan bo'lsa ishlaydi (eski xabardagi tugma boshqa savolni o'tkazib yubormasin) */
export const interviewSkip = (biz: BusinessRow, questionId?: string): InterviewTurn | null => (questionId && load(biz)?.asking !== questionId ? null : interviewReply(biz, 'keyingi'));
export const interviewStop = (biz: BusinessRow): InterviewTurn | null => interviewReply(biz, "to'xta");

/** Tayyor javob tugmasi: faqat o'sha savol hali so'ralayotgan bo'lsa (eski xabardagi tugma boshqa savolga javob bo'lib ketmasin) */
export function interviewOption(biz: BusinessRow, questionId: string, index: number): InterviewTurn | null {
  const state = load(biz);
  if (state?.asking !== questionId) return null;
  const option = questions(biz, state.skipped).pack.find(q => q.id === questionId)?.options?.[index];
  return option ? interviewReply(biz, option) : null;
}
