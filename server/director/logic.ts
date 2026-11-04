/**
 * AI Direktor — sof mantiq (baza va tarmoq yo'q; sinov: scripts/check-direktor.ts).
 *
 * Sikl: raqamlar (oxirgi 7 to'liq kun va undan oldingi 7 kun) → eng katta muammo → xodimlarga 1–3 ta taklif (egasi tugma bilan
 * tasdiqlaydi) → tasdiqlangani xodimga topshiriq va Xotira'ga qaror bo'lib yoziladi → muddati kelganda o'sha ko'rsatkich
 * qayta o'lchanadi: yaxshilandi, yomonlashdi yoki o'zgarmadi. Raqamlarni model emas, kod hisoblaydi.
 */

/** Direktor kuzatadigan ko'rsatkichlar. up — ko'paysa yaxshi, down — kamaysa yaxshi */
export const METRICS = {
  inquiries: { label: 'Murojaatlar', good: 'up', unit: '' },
  answered_pct: { label: 'Javob berilgan ulush', good: 'up', unit: '%' },
  response_min: { label: 'Birinchi javob vaqti', good: 'down', unit: ' daq' },
  unanswered: { label: 'Javobsiz qolganlar', good: 'down', unit: '' },
  booked: { label: 'Qabulga yozilganlar', good: 'up', unit: '' },
  new_leads: { label: 'Yangi mijozlar', good: 'up', unit: '' },
  requests_open: { label: "Ochiq so'rovlar", good: 'down', unit: '' },
  came: { label: 'Kelganlar (CRM)', good: 'up', unit: '' },
  revenue: { label: "Tushum (CRM), so'm", good: 'up', unit: '' },
} as const;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
export const isMetric = (s: unknown): s is MetricKey => typeof s === 'string' && s in METRICS;

/** Har ko'rsatkich: hozirgi 7 kun va undan oldingi 7 kun (yo'q bo'lsa — null: masalan CRM ulanmagan) */
export type Numbers = Partial<Record<MetricKey, { now: number; prev: number } | null>>;

/** Kimga topshiriq berish mumkin: topshiriq oladigan AI xodimlar va egasining o'zi (pul, narx, chegirma, odam — faqat egasi) */
export const MOVE_MEMBERS = ['qabulxona', 'yordamchi', 'tahlilchi', 'marketolog', 'egasi'] as const;
export type MoveMember = typeof MOVE_MEMBERS[number];
export const MEMBER_NAME: Record<MoveMember, string> = { qabulxona: 'Qabulxona', yordamchi: 'Yordamchi', tahlilchi: 'Tahlilchi', marketolog: 'Marketolog', egasi: 'Siz' };

export const LIMITS = { moves: 3, task: 300, why: 300, title: 140, evidence: 400, summary: 300, minDays: 3, maxDays: 14 };

export interface Proposal { member: MoveMember; task: string; why: string; metric: MetricKey; checkDays: number }
export interface DirectorPlan { summary: string; problem: { title: string; evidence: string } | null; moves: Proposal[] }

const one = (s: unknown, max: number): string => String(s ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '').trim().slice(0, max);

/**
 * Model javobini tekshiradi: noma'lum xodim yoki ko'rsatkich — tashlanadi; muddat 3–14 kun oralig'iga keltiriladi; 3 tadan oshmaydi;
 * ma'lumoti yo'q (null) ko'rsatkichga taklif — tashlanadi (o'lchab bo'lmaydi)
 */
export function cleanPlan(raw: unknown, numbers: Numbers, allowed: readonly MoveMember[] = MOVE_MEMBERS): DirectorPlan {
  const r = (raw ?? {}) as { summary?: unknown; problem?: { title?: unknown; evidence?: unknown } | null; moves?: unknown };
  const title = one(r.problem?.title, LIMITS.title);
  const moves = (Array.isArray(r.moves) ? r.moves : []).flatMap((m: Record<string, unknown>) => {
    // Jamoada yo'q xodimga taklif — tashlanadi (egasi uni ishga olmagan)
    const member = allowed.find(x => x === m?.member);
    const task = one(m?.task, LIMITS.task);
    if (!member || !task || !isMetric(m?.metric) || !numbers[m.metric]) return [];
    const days = Math.round(Number(m?.check_days));
    return [{ member, task, why: one(m?.why, LIMITS.why), metric: m.metric, checkDays: Number.isFinite(days) ? Math.min(LIMITS.maxDays, Math.max(LIMITS.minDays, days)) : 3 }];
  }).slice(0, LIMITS.moves);
  return { summary: one(r.summary, LIMITS.summary), problem: title ? { title, evidence: one(r.problem?.evidence, LIMITS.evidence) } : null, moves };
}

export type Verdict = 'yaxshi' | 'yomon' | 'ozgarmadi';
/** O'zgarish shundan kichik bo'lsa — «o'zgarmadi» (tasodifiy tebranish) */
const NOISE_PCT = 5;

/** Natija: boshlang'ich qiymat bilan hozirgisini ko'rsatkich yo'nalishiga qarab solishtiradi */
export function verdict(metric: MetricKey, before: number, after: number): { verdict: Verdict; pct: number | null } {
  const pct = before ? Math.round(((after - before) / before) * 100) : null;
  const delta = after - before;
  const small = pct === null ? delta === 0 : Math.abs(pct) < NOISE_PCT;
  if (small) return { verdict: 'ozgarmadi', pct };
  const better = METRICS[metric].good === 'up' ? delta > 0 : delta < 0;
  return { verdict: better ? 'yaxshi' : 'yomon', pct };
}

export const fmt = (metric: MetricKey, v: number): string => `${Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ')}${METRICS[metric].unit}`;
const arrow = (now: number, prev: number) => (now === prev ? '' : now > prev ? ' ↑' : ' ↓');

/** Modelga beriladigan raqamlar jadvali (faqat bor ko'rsatkichlar) */
export function numbersText(n: Numbers): string {
  return METRIC_KEYS.flatMap(k => {
    const v = n[k];
    return v ? [`- ${k} (${METRICS[k].label}): last 7 days ${Math.round(v.now)}, previous 7 days ${Math.round(v.prev)}, better when ${METRICS[k].good}`] : [];
  }).join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface CheckedMove { task: string; member: MoveMember; metric: MetricKey; before: number; after: number; verdict: Verdict; pct: number | null }
export interface ReportMove { n: number; id: string; member: MoveMember; task: string; why: string; metric: MetricKey; checkAt: string }

/** Takliflar tugmalari: har biriga «✅ N — topshirish» va «✖️» (dv|id, dn|id) */
export const moveButtons = (moves: { n: number; id: string }[]): { text: string; data: string }[][] =>
  moves.map(m => [{ text: `✅ ${m.n} — topshirish`, data: `dv|${m.id}` }, { text: `✖️ ${m.n} — kerak emas`, data: `dn|${m.id}` }]);

const VERDICT_MARK: Record<Verdict, string> = { yaxshi: '✅ yaxshilandi', yomon: '⚠️ yomonlashdi', ozgarmadi: "➖ o'zgarmadi" };
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
export const dayLabel = (d: string): string => `${Number(d.slice(8, 10))}-${MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}`;

/** Ertalabki Direktor xabari (Telegram HTML): raqamlar, muammo, takliflar, tekshirilgan qarorlar natijasi */
export function reportHtml(input: { numbers: Numbers; plan: DirectorPlan | null; moves: ReportMove[]; checked: CheckedMove[] }): string | null {
  const { numbers, plan, moves, checked } = input;
  if (!moves.length && !checked.length && !plan?.problem) return null;
  const out = ['🧭 <b>Direktor</b> — oxirgi 7 kun'];
  const shown = METRIC_KEYS.filter(k => numbers[k]).slice(0, 5)
    .map(k => `• ${METRICS[k].label}: <b>${fmt(k, numbers[k]!.now)}</b>${arrow(numbers[k]!.now, numbers[k]!.prev)} <i>(oldin ${fmt(k, numbers[k]!.prev)})</i>`);
  if (shown.length) out.push('', ...shown);
  if (checked.length) {
    out.push('', '<b>Qarorlar natijasi</b>');
    for (const c of checked) out.push(`• ${esc(c.task)} — ${METRICS[c.metric].label}: ${fmt(c.metric, c.before)} → ${fmt(c.metric, c.after)} ${VERDICT_MARK[c.verdict]}`);
  }
  if (plan?.problem) out.push('', `<b>Eng katta muammo:</b> ${esc(plan.problem.title)}`, ...(plan.problem.evidence ? [`<i>${esc(plan.problem.evidence)}</i>`] : []));
  if (moves.length) {
    out.push('', '<b>Takliflarim</b> — tasdiqlasangiz, xodimga topshiraman va natijasini tekshiraman:');
    for (const m of moves) {
      out.push(`${m.n}. <b>${MEMBER_NAME[m.member]}</b>: ${esc(m.task)}`);
      out.push(`   <i>${m.why ? `${esc(m.why)} · ` : ''}tekshiraman ${dayLabel(m.checkAt)} — ${METRICS[m.metric].label.toLowerCase()}</i>`);
    }
  }
  return out.join('\n');
}

// ─── Maqsadlar (saqlash — goals.ts) ─────────────────────────────────────────

export interface Goal { id: string; metric: MetricKey; target: number; createdAt: string }
export interface GoalProgress extends Goal {
  label: string; unit: string; good: 'up' | 'down';
  /** Joriy qiymat (oxirgi 7 kun) — ma'lumot yo'q bo'lsa null (masalan CRM ulanmagan) */
  now: number | null;
  /** Bajarilish, 0–100; ma'lumot yo'q — null */
  pct: number | null;
  reached: boolean;
}

/** Bajarilish: «ko'paysa yaxshi» — joriy / maqsad; «kamaysa yaxshi» — maqsad / joriy (maqsaddan past bo'lsa — 100%) */
export function progress(g: Goal, numbers: Numbers): GoalProgress {
  const m = METRICS[g.metric];
  const now = numbers[g.metric]?.now ?? null;
  const base = { ...g, label: m.label, unit: m.unit, good: m.good };
  if (now === null) return { ...base, now: null, pct: null, reached: false };
  const reached = m.good === 'up' ? now >= g.target : now <= g.target;
  const raw = m.good === 'up' ? (g.target ? now / g.target : 1) : (now ? g.target / now : 1);
  return { ...base, now, pct: reached ? 100 : Math.max(0, Math.min(99, Math.round(raw * 100))), reached };
}

/** Modelga: maqsadlar va joriy holat */
export function goalsText(list: GoalProgress[]): string {
  return list.map(g => `- ${g.metric}: target ${g.target}${g.unit.trim()}, now ${g.now === null ? 'unknown' : Math.round(g.now)}${g.reached ? ' (reached)' : g.pct === null ? '' : ` (${g.pct}% of target)`}`).join('\n');
}
