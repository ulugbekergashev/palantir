/**
 * Tashqi javobni o'qish, hajmi cheklangan holda: chegaradan oshsa o'qish to'xtatiladi (butun javob xotiraga olinmaydi).
 * Begona server yoki tarmoqdagi qurilma katta javob yuborib xotirani to'ldirmasin.
 */
export async function readCapped(r: Response, max: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error('javob juda katta');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
