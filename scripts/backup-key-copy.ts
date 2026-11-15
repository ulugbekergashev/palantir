/**
 * Tashqi zaxira kalitining PAROLLI nusxasi (H5): hamma klinikaning zaxirasini faqat sotuvchidagi bitta fayl ochadi
 * (~/.palantir/zaxira-kaliti.pem) — kompyuter buzilsa yoki fayl o'chsa, birorta zaxirani tiklab bo'lmasdi.
 *   npm run zaxira-kalit-nusxa -- [--out <fayl>] [--key <maxfiy kalit>]
 * Parol so'raladi (ikki marta, ekranda ko'rinmaydi) yoki ZAXIRA_PAROL dan olinadi. Natija — shifrlangan PEM (PKCS#8, AES-256):
 * fleshkaga, parol menejeriga yoki bulutga qo'ying; parolni alohida saqlang. Tiklash:
 *   npm run restore-backup -- <fayl.pzb> --key <shu nusxa>   (parolni so'raydi)
 */
import { createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { askSecret } from './secretPrompt';

const MIN_PASS = 10;
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keyFile = option('--key') ?? ['.palantir', '.cerebro'].map(dir => join(homedir(), dir, 'zaxira-kaliti.pem')).find(f => existsSync(f)) ?? join(homedir(), '.palantir', 'zaxira-kaliti.pem'); // eski nom
if (!existsSync(keyFile)) { console.error(`Maxfiy kalit topilmadi: ${keyFile}`); process.exit(1); }
const out = option('--out') ?? join(process.cwd(), 'zaxira-kaliti-nusxa.pem');
if (existsSync(out)) { console.error(`${out} allaqachon bor — boshqa nom bering (--out), eski nusxa ustidan yozilmaydi`); process.exit(1); }

let pass = process.env.ZAXIRA_PAROL ?? '';
if (!pass) {
  pass = await askSecret('Nusxa paroli: ');
  if (pass !== await askSecret('Yana bir marta: ')) { console.error('Parollar mos emas'); process.exit(1); }
}
if (pass.length < MIN_PASS) { console.error(`Parol kamida ${MIN_PASS} belgi bo'lsin`); process.exit(1); }

const key = createPrivateKey(readFileSync(keyFile, 'utf8'));
const sealed = key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass });
writeFileSync(out, sealed, { mode: 0o600 });
// O'zini tekshirish: nusxa shu parol bilan ochiladi va asl kalitning o'zi
const back = createPrivateKey({ key: readFileSync(out, 'utf8'), passphrase: pass });
const same = back.export({ type: 'pkcs8', format: 'der' }).equals(key.export({ type: 'pkcs8', format: 'der' }));
if (!same) { console.error('Nusxa tekshiruvdan o\'tmadi — faylni ishlatmang'); process.exit(1); }
console.log(`Parolli nusxa tayyor: ${out}\nUni fleshka yoki parol menejeriga qo'ying, parolni alohida saqlang. Tekshirildi: shu parol bilan ochiladi.`);
