/**
 * Telefon qilib eslatish: SpeechLab'ning AI agenti egasiga qo'ng'iroq qiladi va eslatmani o'zbekcha aytadi
 * (speechlab.uz/docs — «AI agent qo'ng'iroqlari»). Telefon liniyasi va agent SpeechLab panelida sozlanadi;
 * agent yo'riqnomasida {{eslatma}} va {{vaqt}} o'zgaruvchilari ishlatiladi — Cerebro ularni har qo'ng'iroqda yuboradi.
 * Qo'ng'iroq Telegram eslatmasining o'rnini bosmaydi: eslatma baribir Telegram'ga ham keladi.
 */
import { env } from './env';

const TIMEOUT_MS = 20_000;

/** SpeechLab javob kodlari → egasiga tushunarli sabab (hujjatdagi ro'yxat) */
const REASON: Record<number, string> = {
  401: 'SpeechLab kaliti ishlamayapti',
  402: 'SpeechLab balansi tugagan — hisobni to\'ldiring',
  403: "SpeechLab kalitida «AI agent qo'ng'iroqlari» ruxsati yo'q",
  409: "SpeechLab'da telefon liniyasi ulanmagan yoki bu raqam qo'ng'iroqni rad etgan",
  422: "raqam yoki agent noto'g'ri",
  429: "qo'ng'iroqlar juda tez-tez (bitta raqamga soatiga 3 tadan ko'p emas)",
};

export const callsEnabled = (): boolean => !!env.speechlabKey;

export class CallError extends Error {}

export interface CallRequest {
  to: string;
  name: string;
  vars: Record<string, string | number>;
  /** Sizdagi hujjat raqami: bir kunda shu raqam bilan ikkinchi so'rov yangi qo'ng'iroq qilmaydi (qayta urinish xavfsiz) */
  externalId: string;
}

const headers = () => ({ authorization: `Bearer ${env.speechlabKey}`, 'content-type': 'application/json' });

/** Qo'ng'iroq qildiradi. Qaytaradi: SpeechLab'dagi qo'ng'iroq id'si. Xato — CallError (sababi bilan) */
export async function placeCall(req: CallRequest): Promise<{ id: number }> {
  const res = await fetch(`${env.speechlabUrl}/agent-calls`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ to: req.to, name: req.name, vars: req.vars, external_id: req.externalId, ...(env.speechlabAgentId ? { agent_id: env.speechlabAgentId } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({})) as { id?: number; status?: string; error?: string };
  // Shu eslatma uchun qo'ng'iroq allaqachon qilingan — yangisi kerak emas
  if (res.status === 409 && body.status === 'duplicate' && body.id) return { id: body.id };
  if (!res.ok || !body.id) throw new CallError(REASON[res.status] ?? `SpeechLab javob bermadi (${res.status})`);
  return { id: body.id };
}

export interface CallState { status: string; finished: boolean; durationSec: number | null }

/** Qo'ng'iroq natijasi: active — terilmoqda; done/transferred — gaplashildi; no_answer/failed — bo'lmadi */
export async function callState(id: number): Promise<CallState> {
  const res = await fetch(`${env.speechlabUrl}/agent-calls/${id}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new CallError(REASON[res.status] ?? `SpeechLab javob bermadi (${res.status})`);
  const body = await res.json() as { status?: string; finished?: boolean; duration_sec?: number };
  return { status: String(body.status ?? ''), finished: !!body.finished, durationSec: body.duration_sec ?? null };
}
