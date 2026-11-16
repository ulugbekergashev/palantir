/**
 * Murabbiy (HR · o'rgatish). Egasi: «Dilnozani o'rgat» → AI klinikaning o'z bilimidan (narxlar, qoidalar, savol-javoblar, jamoa —
 * brain/index.ts knowledgeText) 3–6 qisqa dars va har darsga 2–3 test savoli yozadi (bitta so'rov) → xodimga Telegram'da 1-dars:
 * «✅ O'qidim — test» → savollar tugmalar bilan (javobni AI tekshirmaydi — to'g'ri variant kursda yozilgan, token ketmaydi) →
 * xato bo'lsa to'g'risi va sababi → «➡️ Keyingi dars» (xodim o'z tezligida) → oxirida egasiga natija: nechta to'g'ri, qaysi mavzuda xato.
 * Kurs faqat Telegram'ga ulangan xodimga (staff.chat_id) beriladi.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { crewWorks } from '../../src/lib/crew';
import { think } from '../claude';
import { knowledgeText } from '../brain/index';
import { businesses, newId, sql, type BusinessRow, type Row } from '../db';
import { env } from '../env';
import { staff, type StaffRow } from '../requests/store';
import { withLane } from '../subscription/pressure';

sql.exec(`
CREATE TABLE IF NOT EXISTS trainings (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, staff_id TEXT NOT NULL, title TEXT NOT NULL, lessons TEXT NOT NULL,
  lesson INTEGER NOT NULL DEFAULT 0, answers TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trainings_biz ON trainings (business_id, created_at);
`);

export class TrainError extends Error {}

export interface Quiz { q: string; options: string[]; correct: number; why: string }
export interface Lesson { title: string; text: string; quiz: Quiz[] }
export interface Answer { lesson: number; quiz: number; ok: boolean }
export type TrainingStatus = 'active' | 'done' | 'cancelled';
export interface Training {
  id: string; businessId: string; staffId: string; title: string; lessons: Lesson[]; lesson: number; answers: Answer[]; status: TrainingStatus;
  createdAt: string; updatedAt: string;
}

const MIN_LESSONS = 2, MAX_LESSONS = 6, MAX_QUIZ = 3, MAX_OPTIONS = 4;
const LESSON_MAX = 1200;

const parse = <T>(v: unknown, fallback: T): T => { try { return JSON.parse(String(v)) as T; } catch { return fallback; } };
const toTraining = (r: Row): Training => ({
  id: String(r.id), businessId: String(r.business_id), staffId: String(r.staff_id), title: String(r.title), lessons: parse<Lesson[]>(r.lessons, []),
  lesson: Number(r.lesson), answers: parse<Answer[]>(r.answers, []), status: String(r.status) as TrainingStatus, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

export const trainings = {
  create(businessId: string, staffId: string, title: string, lessons: Lesson[]): Training {
    const id = newId(10), now = sql.nowIso();
    // Bitta xodimda bitta ochiq kurs: eskisi bekor
    sql.run("UPDATE trainings SET status = 'cancelled', updated_at = ? WHERE business_id = ? AND staff_id = ? AND status = 'active'", now, businessId, staffId);
    sql.run('INSERT INTO trainings (id, business_id, staff_id, title, lessons, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, businessId, staffId, title, JSON.stringify(lessons), now, now);
    return trainings.get(businessId, id)!;
  },
  get: (businessId: string, id: string) => sql.one('SELECT * FROM trainings WHERE business_id = ? AND id = ?', toTraining, businessId, id),
  byId: (id: string) => sql.one('SELECT * FROM trainings WHERE id = ?', toTraining, id),
  list: (businessId: string, limit = 30) => sql.many('SELECT * FROM trainings WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toTraining, businessId, limit),
  /** Javob yoziladi faqat shu savolga hali javob berilmagan bo'lsa (tugma ikki marta bosilsa — bir marta sanaladi) */
  answer(t: Training, a: Answer): boolean {
    if (t.answers.some(x => x.lesson === a.lesson && x.quiz === a.quiz)) return false;
    sql.run('UPDATE trainings SET answers = ?, updated_at = ? WHERE id = ?', JSON.stringify([...t.answers, a]), sql.nowIso(), t.id);
    return true;
  },
  next: (id: string, lesson: number, status: TrainingStatus) => { sql.run('UPDATE trainings SET lesson = ?, status = ?, updated_at = ? WHERE id = ?', lesson, status, sql.nowIso(), id); },
  cancel: (businessId: string, id: string): boolean =>
    Number(sql.run("UPDATE trainings SET status = 'cancelled', updated_at = ? WHERE business_id = ? AND id = ? AND status = 'active'", sql.nowIso(), businessId, id).changes) > 0,
};

// ─── AI: kurs ────────────────────────────────────────────────────────────────

const COURSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'lessons'],
  properties: {
    title: { type: 'string' },
    lessons: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['title', 'text', 'quiz'],
        properties: {
          title: { type: 'string' }, text: { type: 'string' },
          quiz: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'options', 'correct', 'why'],
            properties: { q: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, correct: { type: 'integer' }, why: { type: 'string' } } } },
        },
      },
    },
  },
};

const COURSE_SYSTEM = `You are the trainer of a small business in Uzbekistan. You write a short onboarding course for a new staff member, read in Telegram.
- Use ONLY the business knowledge given in <knowledge>: prices, services, rules, answers to customer questions, team, hours, address. Never invent a price, rule or fact. If the knowledge is thin, make fewer lessons.
- 2–6 lessons, most important first (what customers ask most, prices, booking rules, how to talk to customers). Each lesson: a title and a text of 400–1000 characters, plain text, short sentences, concrete numbers from the knowledge.
- After each lesson 2–3 multiple-choice questions on that lesson only: 3–4 short options, exactly one correct (correct = its 0-based index), and «why» — one sentence explaining the right answer. Mix the position of the correct option.
- Write in the business's content language (Uzbek unless the profile says Russian). Follow the owner's focus if given.`;

export async function writeCourse(biz: BusinessRow, focus: string): Promise<{ title: string; lessons: Lesson[] }> {
  const knowledge = knowledgeText(biz);
  const res: Anthropic.Beta.BetaMessage = await withLane('heavy', () => think(biz.id, 'owner', {
    model: env.aiModel, max_tokens: 8000, system: COURSE_SYSTEM,
    messages: [{ role: 'user', content: `<knowledge>\n${knowledge}\n</knowledge>\n\n<owner_focus>\n${focus || '(general onboarding)'}\n</owner_focus>` }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: COURSE_SCHEMA } },
  }));
  if (res.stop_reason === 'refusal') throw new TrainError('AI kurs yozmadi');
  const raw = JSON.parse(res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')) as { title?: unknown; lessons?: unknown };
  const lessons = cleanLessons(raw.lessons);
  if (lessons.length < MIN_LESSONS) throw new TrainError("Kurs uchun bilim yetarli emas — avval Miya'ga narxlar, qoidalar va savol-javoblarni kiriting");
  return { title: String(raw.title ?? '').trim().slice(0, 100) || "Yangi xodim kursi", lessons };
}

/** Model yozgan kurs: noto'g'ri savol (variant kam, to'g'ri javob indeksi yo'q) tashlanadi — tugmada xato javob «to'g'ri» bo'lib qolmasin */
export function cleanLessons(v: unknown): Lesson[] {
  const list = Array.isArray(v) ? v : [];
  return list.slice(0, MAX_LESSONS).flatMap((l: Record<string, unknown>) => {
    const quiz = (Array.isArray(l?.quiz) ? l.quiz : []).flatMap((q: Record<string, unknown>) => {
      const options = (Array.isArray(q?.options) ? q.options : []).map(o => String(o).trim().slice(0, 60)).filter(Boolean).slice(0, MAX_OPTIONS);
      const correct = Number(q?.correct);
      if (!String(q?.q ?? '').trim() || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) return [];
      return [{ q: String(q.q).trim().slice(0, 300), options, correct, why: String(q.why ?? '').trim().slice(0, 300) }];
    }).slice(0, MAX_QUIZ);
    const text = String(l?.text ?? '').trim().slice(0, LESSON_MAX);
    return text && quiz.length ? [{ title: String(l.title ?? '').trim().slice(0, 100) || 'Dars', text, quiz }] : [];
  });
}

// ─── Telegram ────────────────────────────────────────────────────────────────

type Buttons = { text: string; data: string }[][];
export interface TrainBot { send(chatId: string, html: string, buttons?: Buttons): Promise<void> }
let trainBot: TrainBot | null = null;
export const setTrainBot = (b: TrainBot | null): void => { trainBot = b; };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Tugma ma'lumoti: mq|<kurs>.<dars>.<savol>.<variant> (64 bayt ichida) */
const quizData = (t: Training, l: number, q: number, o: number) => `mq|${t.id}.${l}.${q}.${o}`;

/** Xodimni topadi: id yoki ism (ism bo'yicha — bitta mos kelsa) */
export function traineeOf(bizId: string, who: string): StaffRow {
  const list = staff.list(bizId);
  const w = who.trim().toLowerCase();
  const found = list.find(s => s.id === who) ?? (() => { const m = list.filter(s => s.name.toLowerCase().includes(w)); return m.length === 1 ? m[0] : undefined; })();
  if (!found) throw new TrainError(list.length ? `Xodim topilmadi. Xodimlar: ${list.map(s => s.name).join(', ')}` : "Xodim yo'q — avval panel → Sozlamalar → Xodimlar'da qo'shing");
  if (!found.chatId) throw new TrainError(`${found.name} hali Telegram'ga ulanmagan — unga xodim havolasini yuboring`);
  return found;
}

/** Kurs ochiladi va xodimga 1-dars ketadi */
export async function startTraining(biz: BusinessRow, who: string, focus = ''): Promise<{ training: Training; trainee: StaffRow }> {
  // Egasi Murabbiyni jamoadan olib tashlagan — yangi kurs yo'q (boshlanganlari tugaguncha davom etadi)
  if (!crewWorks(biz, 'murabbiy')) throw new TrainError("Murabbiy jamoada yo'q — AI xodimlar sahifasida qayta qo'shing");
  const trainee = traineeOf(biz.id, who);
  const course = await writeCourse(biz, focus);
  const t = trainings.create(biz.id, trainee.id, course.title, course.lessons);
  await trainBot?.send(trainee.chatId!, `🎓 <b>${esc(course.title)}</b>\n${esc(biz.profile.name)} sizga ${course.lessons.length} ta qisqa dars tayyorladi: o'qing, keyin 2–3 savolga javob bering. O'z tezligingizda.`);
  await sendLesson(t, 0, trainee.chatId!);
  return { training: t, trainee };
}

async function sendLesson(t: Training, l: number, chatId: string): Promise<void> {
  const lesson = t.lessons[l];
  await trainBot?.send(chatId, `📖 <b>${l + 1}/${t.lessons.length}. ${esc(lesson.title)}</b>\n\n${esc(lesson.text)}`, [[{ text: "✅ O'qidim — test", data: `mt|${t.id}.${l}` }]]);
}

async function sendQuiz(t: Training, l: number, q: number, chatId: string): Promise<void> {
  const quiz = t.lessons[l].quiz[q];
  await trainBot?.send(chatId, `❓ <b>${q + 1}/${t.lessons[l].quiz.length}.</b> ${esc(quiz.q)}`, quiz.options.map((o, i) => [{ text: o, data: quizData(t, l, q, i) }]));
}

/** Natija: to'g'ri javoblar va xato qilingan darslar */
export function score(t: Training): { right: number; total: number; weak: string[] } {
  const total = t.lessons.reduce((n, l) => n + l.quiz.length, 0);
  const right = t.answers.filter(a => a.ok).length;
  const weak = [...new Set(t.answers.filter(a => !a.ok).map(a => t.lessons[a.lesson]?.title).filter((x): x is string => !!x))];
  return { right, total, weak };
}

/**
 * Xodim bosgan tugma (botButtons.ts): mt — testni boshlash, mq — savolga javob, mn — keyingi dars. Qaytadi: xodimga qisqa javob (toast)
 * yoki null — bu kurs tugmasi emas. Kursni faqat o'sha xodim bosadi
 */
export async function trainingButton(chatId: string, code: string, arg: string): Promise<string | null> {
  if (code !== 'mt' && code !== 'mq' && code !== 'mn') return null;
  const [id, ...nums] = arg.split('.');
  const t = trainings.byId(id);
  const me = t && staff.byId(t.businessId, t.staffId);
  if (!t || !me || me.chatId !== chatId) return 'Bu tugma eskirgan';
  if (t.status !== 'active') return 'Bu kurs yopilgan';
  const [l, q, o] = nums.map(Number);
  if (!Number.isInteger(l) || !t.lessons[l]) return 'Bu tugma eskirgan';
  if (code === 'mt') {
    if (l !== t.lesson) return 'Bu tugma eskirgan';
    await sendQuiz(t, l, 0, chatId);
    return 'Test';
  }
  if (code === 'mn') {
    if (l !== t.lesson + 1 || !t.lessons[l]) return 'Bu tugma eskirgan';
    trainings.next(t.id, l, 'active');
    await sendLesson(t, l, chatId);
    return 'Keyingi dars';
  }
  const quiz = t.lessons[l].quiz[q];
  if (!quiz || !Number.isInteger(o) || !quiz.options[o]) return 'Bu tugma eskirgan';
  const ok = o === quiz.correct;
  if (!trainings.answer(t, { lesson: l, quiz: q, ok })) return 'Javob allaqachon berilgan';
  await trainBot?.send(chatId, ok ? `✅ To'g'ri!${quiz.why ? ` ${esc(quiz.why)}` : ''}` : `❌ To'g'ri javob: <b>${esc(quiz.options[quiz.correct])}</b>.${quiz.why ? ` ${esc(quiz.why)}` : ''}`);
  if (q + 1 < t.lessons[l].quiz.length) { await sendQuiz(t, l, q + 1, chatId); return ok ? "To'g'ri" : "Xato"; }
  // Dars tugadi
  if (l + 1 < t.lessons.length) {
    await trainBot?.send(chatId, `Dars tugadi 👍`, [[{ text: '➡️ Keyingi dars', data: `mn|${t.id}.${l + 1}` }]]);
    return ok ? "To'g'ri" : 'Xato';
  }
  trainings.next(t.id, l, 'done');
  const done = trainings.get(t.businessId, t.id)!;
  const s = score(done);
  await trainBot?.send(chatId, `🎉 Kurs tugadi! Natija: ${s.right}/${s.total}. Rahmat!`);
  const biz = businesses.byId(t.businessId);
  if (biz?.ownerChatId) {
    await trainBot?.send(biz.ownerChatId, [`🎓 <b>${esc(me.name)}</b> «${esc(t.title)}» kursini tugatdi: <b>${s.right}/${s.total}</b> to'g'ri.`,
      s.weak.length ? `Xato qilgan mavzular: ${s.weak.map(esc).join(', ')} — shularni o'zingiz ham bir eslatib qo'ying.` : "Hamma mavzuni yaxshi o'zlashtirdi."].join('\n'));
  }
  return ok ? "To'g'ri" : 'Xato';
}
