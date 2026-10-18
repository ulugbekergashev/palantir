/**
 * Rasmiy Instagram qoidalari — sof (bazaga tegmaydi; instagramApi.ts va sinovlar ishlatadi).
 */
const DAY_MS = 86_400_000;
/** Mijozning oxirgi xabaridan shu vaqt ichida — oddiy javob */
export const WINDOW_MS = DAY_MS;
/** Human Agent ruxsati bilan — shu vaqtgacha (HUMAN_AGENT tegi) */
export const HUMAN_AGENT_MS = 7 * DAY_MS;
/** Instagram xabarining chegarasi — 1000 bayt (UTF-8) */
export const MAX_BYTES = 1000;

/** Instagram'ga yozish mumkinmi: 24 soat ichida — oddiy; 7 kungacha — faqat Human Agent ruxsati bilan; undan keyin — yo'q */
export function windowRule(lastInboundAt: string | null, now: number, humanAgent: boolean): 'open' | 'human_agent' | 'closed' {
  const last = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (!Number.isFinite(last)) return 'closed';
  const age = now - last;
  if (age <= WINDOW_MS) return 'open';
  return humanAgent && age <= HUMAN_AGENT_MS ? 'human_agent' : 'closed';
}

/** Matnni Instagram chegarasiga sig'adigan bo'laklarga bo'ladi (imkon bo'lsa so'z o'rtasidan emas) */
export function splitForInstagram(text: string, max = MAX_BYTES): string[] {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  if (bytes(text) <= max) return [text];
  const parts: string[] = [];
  let cur = '';
  for (const word of text.split(/(\s+)/)) {
    if (bytes(cur + word) <= max) { cur += word; continue; }
    if (cur.trim()) parts.push(cur.trim());
    cur = word.trimStart();
    // Bitta «so'z» chegaradan uzun (havola) — belgi bo'yicha kesiladi (emoji yoki harf ikkiga bo'linmaydi)
    while (bytes(cur) > max) {
      const chars = [...cur];
      let n = chars.length;
      while (bytes(chars.slice(0, n).join('')) > max) n--;
      parts.push(chars.slice(0, n).join(''));
      cur = chars.slice(n).join('');
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
