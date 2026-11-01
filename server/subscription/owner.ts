/**
 * Egasining yordamchisi obuna orqali (AI_ENGINE=subscription): bitta gap — bitta Agent SDK so'rovi, Palantir asboblari MCP orqali.
 * Suhbat davomi SDK sessiyasida saqlanadi (conversations.tools_key = sessionKey); tizim ko'rsatmasi sessiya davomida o'zgarmaydi —
 * API rejimidagidek. Uzoq tanaffusdan keyin yoki sessiya bir kundan eskirganda yangisi boshlanadi (uzun suhbatni SDK o'zi qisqartiradi).
 *
 * Kunlik chegara (AI_DAILY_OWNER) obunada gap boshiga bir marta sanaladi (API rejimida — har bir qadam).
 */
import type { BusinessRow } from '../db';
import { conversations } from '../db';
import { env } from '../env';
import { metered } from '../claude';
import type { ToolCtx } from '../tools';
import { SubscriptionError, runQuery, sessionKey, sessionOf, type TurnResult } from './engine';
import { ToolGate, palantirServer } from './tools';

/** Ko'rsatmadagi asbob nomlari (create_task, list_leads…) obunada «mcp__palantir__» bilan boshlanadi */
const TOOL_NAMES_NOTE = 'Your tools are provided by the "palantir" server, so their full names start with "mcp__palantir__" (for example mcp__palantir__create_task); the instructions above refer to them by the short name.';
/** API rejimidagi MAX_STEPS ga yaqin: bir gapda asboblar bilan shuncha qadam */
const MAX_TURNS = 12;
/** Bitta SDK sessiyasining eng uzoq umri: undan keyin yangi ko'rsatma (yangi sana, yangi bilim) bilan qaytadan */
const MAX_SESSION_MS = 24 * 3600_000;
export const CUT_NOTE = "(Ish ko'p qadamli chiqdi — davomini yozing, men davom ettiraman.)";
const REFUSED = "Bu so'rovni bajara olmayman.";

export interface OwnerTurnInput {
  biz: BusinessRow;
  /** Asboblar to'plamining kaliti (agent.ts Toolset.key): o'zgarsa — yangi sessiya */
  setKey: string;
  crm: boolean;
  userText: string;
  phone: boolean;
  idleMs: number;
  /** Asboblar shu kontekstda ishlaydi; xato bo'lsa chaqiruvchi tayyor bo'lgan narsalarni (artifacts) shundan oladi */
  ctx: ToolCtx;
  buildSystem: (b: BusinessRow) => string;
}

interface Session { resume: string; system: string; startedAt: string }

function liveSession(p: OwnerTurnInput): Session | null {
  const prev = conversations.get(p.biz.id);
  if (!prev) return null;
  const now = Date.now();
  if (now - Date.parse(prev.updatedAt) >= p.idleMs || now - Date.parse(prev.startedAt) >= MAX_SESSION_MS) return null;
  const resume = sessionOf(prev.toolsKey, p.setKey);
  return resume ? { resume, system: prev.system, startedAt: prev.startedAt } : null;
}

export async function ownerTurn(p: OwnerTurnInput): Promise<string> {
  const session = liveSession(p);
  const gate = new ToolGate();
  try {
    return await turn(p, session, gate);
  } catch (e) {
    // Eski sessiya ochilmadi va hech bir asbob ishlamagan — yangi sessiya bilan bir marta (asbob ishlagan bo'lsa, qayta urinish
    // ishni ikki marta qilardi: masalan, ikkita qabul). Vaqt tugagan bo'lsa ham qayta urinilmaydi: navbat yana 10 daqiqa band bo'lardi
    if (session && gate.calls === 0 && e instanceof SubscriptionError && e.reason === 'failed') return turn(p, null, new ToolGate());
    throw e;
  }
}

async function turn(p: OwnerTurnInput, session: Session | null, gate: ToolGate): Promise<string> {
  const system = session?.system ?? `${p.buildSystem(p.biz)}\n\n${TOOL_NAMES_NOTE}`;
  const startedAt = session?.startedAt ?? new Date().toISOString();
  const save = (sessionId: string) => conversations.save(p.biz.id, { system, toolsKey: sessionKey(p.setKey, sessionId), startedAt, messages: [] });
  let r: TurnResult;
  try {
    r = await metered(p.biz.id, 'owner', () => runQuery(p.userText, {
      system,
      model: env.aiModel,
      // Telefonda suhbatdosh jim kutib turadi: chuqur o'ylashdan tez javob muhimroq
      effort: p.phone ? 'low' : env.aiEffortOwner,
      maxTurns: MAX_TURNS,
      ...(session ? { resume: session.resume } : {}),
      mcp: palantirServer(p.ctx, p.crm, gate),
      webSearch: env.webSearch,
      // Internetdan qidiruv natijasi — begona matn: shu gapda bilim va xotiraga yozuvchi asboblar yopiladi
      onWebSearch: () => { p.ctx.readStrangers = true; },
      persist: true,
    }), res => res.usage);
  } catch (e) {
    // Asboblar ishlagan bo'lsa — o'sha sessiya saqlanadi: keyingi gapda model nima qilinganini biladi
    if (gate.calls > 0 && e instanceof SubscriptionError && e.sessionId) save(e.sessionId);
    throw e;
  } finally {
    await gate.close();
  }
  save(r.sessionId);
  if (r.refused) return REFUSED;
  const text = r.text || (p.ctx.artifacts.length ? 'Tayyor.' : '…');
  return r.cut ? `${text}\n\n${CUT_NOTE}` : text;
}
