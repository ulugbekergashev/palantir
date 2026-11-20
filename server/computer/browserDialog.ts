/**
 * Brauzerning o'z oynalari (alert / confirm / prompt). Ochiq turganda sahifa to'xtaydi: har qanday o'qish yoki bosish oyna yopilishini
 * kutib osilib qoladi (2026-11-20, the-internet.herokuapp.com: prompt ochildi — ish 10 daqiqa qimirlamadi). Shuning uchun oyna ochilgani
 * modelga darhol aytiladi va unga oddiy a'zolar bilan javob beriladi: type — prompt'ga matn, key Enter — OK, key Escape — Bekor.
 * OK — tugma bosish bilan bir xil: to'lov so'ragan oynada bosilmaydi, xavfli (o'chirish, yuborish) oyna egasidan so'raladi.
 * Fayl tanlash oynasi (kind: file) ham shunday: egasining ekranida Windows oynasi ochilmaydi; faqat shu ishda yuklab olingan fayl
 * tanlanadi (kompyuterdagi boshqa fayllar — yo'q) va saytga yuklash egasidan so'raladi.
 */
import type { Dialog } from 'playwright-core';
import { riskyClick } from './policy';
import { MONEY_ZONE, cardLike, moneyAction } from './money';

export interface OpenDialog { kind: string; message: string; defaultValue: string; typed: string | null }

/** Oyna ochiq turganda a'zoga nima qilinadi */
export type DialogStep =
  | { do: 'accept'; text?: string; ask: string | null }
  | { do: 'dismiss' }
  | { do: 'typed'; text: string }
  | { do: 'wait' }
  | { do: 'refuse'; why: string };

const KINDS: Record<string, string> = { alert: 'xabar (alert)', confirm: 'tasdiqlash (confirm)', prompt: "so'rov (prompt)", file: 'fayl tanlash' };
const MESSAGE_MAX = 300;

export const fromDialog = (d: Dialog): OpenDialog => ({ kind: d.type(), message: d.message().slice(0, MESSAGE_MAX), defaultValue: d.defaultValue(), typed: null });

/** Modelga: qanday oyna, nima deyapti, qanday javob beriladi */
export function describeDialog(o: OpenDialog): string {
  const how = o.kind === 'file'
    ? "Fayl tanlash: type (ro'yxatdagi fayl nomi), keyin key \"Enter\"; key \"Escape\" — fayl tanlamasdan yopish"
    : o.kind === 'prompt'
    ? 'Javob yozish: type (matn), keyin key "Enter" — OK; key "Escape" — Bekor (Cancel)'
    : o.kind === 'confirm' ? 'key "Enter" — OK; key "Escape" — Bekor (Cancel)' : 'key "Enter" — yopish';
  const typed = o.typed !== null ? ` Yozilgan javob: «${o.typed}» (hali yuborilmagan).` : '';
  return `Sahifada brauzer oynasi ochiq — ${KINDS[o.kind] ?? o.kind}: «${o.message}».${typed} Oyna yopilmaguncha sahifani o'qib ham, bosib ham bo'lmaydi. ${how}.`;
}

const ENTER = /^(enter|return|kp_enter)$/i;
const ESCAPE = /^(escape|esc)$/i;

/** Oyna ochiq: a'zo nima qiladi. Pul zonasi va xavfli tasdiq — bu yerda; egasidan so'rash (ask) — chaqiruvchida */
export function dialogStep(o: OpenDialog, name: string, input: Record<string, unknown>): DialogStep {
  if (name === 'wait') return { do: 'wait' };
  if (name === 'type') {
    const t = String(input.text ?? '');
    if (o.kind !== 'prompt' && o.kind !== 'file') return { do: 'refuse', why: `Bu oynaga yozib bo'lmaydi. ${describeDialog(o)}` };
    if (cardLike(t)) return { do: 'refuse', why: `Karta raqami yozilmaydi. ${MONEY_ZONE}` };
    return { do: 'typed', text: t };
  }
  if (name === 'key') {
    const key = String(input.text ?? '').trim();
    if (ESCAPE.test(key)) return o.kind === 'alert' ? { do: 'accept', ask: null } : { do: 'dismiss' };
    if (ENTER.test(key)) {
      if (o.kind === 'alert') return { do: 'accept', ask: null };
      if (o.kind === 'file') {
        return o.typed === null ? { do: 'refuse', why: `Avval fayl nomini yozing. ${describeDialog(o)}` } : { do: 'accept', text: o.typed, ask: `«${o.typed.slice(0, 80)}» faylini saytga yuklash` };
      }
      // OK — oynadagi savolga «ha»: «500 000 so'm to'lovni tasdiqlaysizmi?» — to'lov tugmasini bosish bilan bir xil
      if (moneyAction(o.message)) return { do: 'refuse', why: `Oyna to'lovni tasdiqlashni so'rayapti — OK bosilmaydi. ${MONEY_ZONE}. Bekor qilish: key "Escape"` };
      const risky = riskyClick({ tag: 'button', role: 'button', name: o.message });
      return { do: 'accept', text: o.kind === 'prompt' ? (o.typed ?? o.defaultValue) : undefined, ask: risky ? `Oynada OK: «${o.message.slice(0, 120)}»` : null };
    }
  }
  return { do: 'refuse', why: describeDialog(o) };
}
