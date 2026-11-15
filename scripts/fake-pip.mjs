/**
 * Soxta Python/pip — yangilovchi sinovi uchun (scripts/e2e-update.ts, TG_CALL_PYTHON=shu fayl): `-m pip install … -r <fayl>`.
 * Har chaqiruvda ro'yxat matni FAKE_PIP_LOG ga bir qator (JSON) bo'lib yoziladi. Ro'yxatda «buzuq-kutubxona» bo'lsa — pip kabi yiqiladi.
 */
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args[args.indexOf('-r') + 1];
if (args[0] !== '-m' || args[1] !== 'pip' || !file) {
  process.stderr.write(`soxta pip: ${args.join(' ')} — bilmayman\n`);
  process.exit(2);
}
const req = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
appendFileSync(process.env.FAKE_PIP_LOG, `${JSON.stringify({ req })}\n`);
if (/buzuq-kutubxona/.test(req)) {
  process.stderr.write('ERROR: Could not find a version that satisfies the requirement buzuq-kutubxona==9.9\nERROR: No matching distribution found for buzuq-kutubxona==9.9\n');
  process.exit(1);
}
