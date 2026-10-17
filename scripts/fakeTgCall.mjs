// Sinov uchun soxta Telegram qo'ng'irog'i (tgvoice/call_live.py o'rnida, telefon jiringlamaydi).
// Nima bilan chaqirilganini FAKE_TGCALL_DIR/calls.jsonl ga yozadi va FAKE_TGCALL_DIR/exit dagi kod bilan chiqadi
// (yo'q bo'lsa 0 — gaplashildi; 2 — ko'tarmadi). Cerebro bergan kalit bilan vazifani ko'ra olishini ham tekshiradi.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_TGCALL_DIR;
const start = Date.now();
const [to, flag, taskId] = process.argv.slice(2);
let sawTask = false;
try {
  const r = await fetch(`${process.env.CEREBRO_URL}/api/tasks?status=open`, { headers: { authorization: `Bearer ${process.env.CEREBRO_TOKEN}` } });
  sawTask = ((await r.json()).tasks ?? []).some(t => t.id === taskId);
} catch { /* sawTask false qoladi */ }
// Qo'ng'iroq bir oz davom etadi — navbat (bir vaqtda bitta qo'ng'iroq) tekshirilishi uchun
await new Promise(r => setTimeout(r, 400));
const code = existsSync(join(dir, 'exit')) ? Number(readFileSync(join(dir, 'exit'), 'utf8')) : 0;
appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify({ to, flag, taskId, sawTask, code, start, end: Date.now() })}\n`);
process.exit(code);
