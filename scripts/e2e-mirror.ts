/**
 * Obsidian ko'rinishi (server/brain/mirror.ts): Vazifalar.md ikki tomonlama, Qo'ng'iroqlar/ sahifalari, telefondagi AI uchun bilim.
 * Haqiqiy server ustida: egasi fayldagi qatorni o'zgartiradi → /api/tasks bazadagi natijani ko'rsatadi va aksincha.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../src/types';
import type { Harness } from './e2e-crm';

export async function mirrorTests({ ok, api, token, otherToken, dataDir }: Harness): Promise<void> {
  console.log("\n# Obsidian: Vazifalar.md, qo'ng'iroqlar va telefon uchun bilim");
  const root = join(dataDir, String((await api('/api/brain', { token })).json.brain.vault));
  const file = join(root, 'Vazifalar.md');
  const read = () => readFileSync(file, 'utf8');
  const tasks = async () => (await api('/api/tasks', { token })).json.tasks as Task[];

  const a = (await api('/api/tasks', { token, body: { title: "Universitet bilan bog'lanish", dueAt: '2026-11-02T09:00' } })).json.task as Task;
  const b = (await api('/api/tasks', { token, body: { title: 'Taklif yozish' } })).json.task as Task;
  const lineA = `- [ ] Universitet bilan bog'lanish 📅 2026-11-02 09:00 ^${a.id}`, lineB = `- [ ] Taklif yozish ^${b.id}`;
  ok("vazifa qo'shilishi bilan Vazifalar.md da: katakcha, 📅 vaqt va ^id; mundarijada havola", read().includes(lineA) && read().includes(lineB)
    && readFileSync(join(root, 'INDEKS.md'), 'utf8').includes('[[Vazifalar|Vazifalar]]'), read().slice(0, 400));

  // Egasi Obsidian'da: birinchisini belgiladi, ikkinchisining nomi va vaqtini o'zgartirdi, ikkita yangi qator yozdi
  writeFileSync(file, `${read().replace(lineA, lineA.replace('- [ ]', '- [x]')).replace(lineB, `- [ ] Taklif yozish (Tabassum) 📅 2026-11-03 14:00 ^${b.id}`)}
- [ ] Akmal akaga qo'ng'iroq 2026-11-04 10:30
- [ ] Noto'g'ri sana 2026-13-45 10:00
`);
  let list = await tasks();
  const byId = (id: string) => list.find(t => t.id === id);
  ok("Obsidian → baza: belgilangani — bajarildi; nomi va vaqti o'zgargani — bazada ham", byId(a.id)?.status === 'done' && byId(b.id)?.title === 'Taklif yozish (Tabassum)' && byId(b.id)?.dueAt === '2026-11-03T14:00',
    JSON.stringify([byId(a.id), byId(b.id)]));
  const akmal = list.find(t => t.title === "Akmal akaga qo'ng'iroq");
  const wrong = list.find(t => t.title === "Noto'g'ri sana");
  ok("kalitsiz yangi qator — yangi vazifa (vaqti bilan); mavjud bo'lmagan sana vazifani vaqtsiz qoldiradi", akmal?.dueAt === '2026-11-04T10:30' && akmal.status === 'open' && wrong?.dueAt === null,
    JSON.stringify([akmal, wrong]));
  ok("fayl qayta yozildi: yangi qatorlar ^id oldi, bajarilgani «Bajarildi» bo'limida", !!akmal && read().includes(`📅 2026-11-04 10:30 ^${akmal.id}`) && new RegExp(`## Bajarildi[\\s\\S]*\\^${a.id}`).test(read()), read());

  // Panelda o'zgardi, egasi faylga tegmadi — fayl bazaga moslashadi (eski holat qaytib yozilmaydi)
  await api(`/api/tasks/${b.id}`, { token, method: 'PATCH', body: { status: 'done' } });
  ok("baza → Obsidian: panelda bajarildi — faylda ham [x], qaytib ochilmaydi", read().includes(`- [x] Taklif yozish (Tabassum) 📅 2026-11-03 14:00 ^${b.id}`)
    && (await tasks()).find(t => t.id === b.id)?.status === 'done');

  // [-] — bekor; qatorni o'chirish vazifani o'chirmaydi (adashib bo'shatilgan fayl hamma narsani yo'qotmasin)
  writeFileSync(file, read().replace(`- [ ] Akmal akaga qo'ng'iroq 📅 2026-11-04 10:30 ^${akmal?.id}`, `- [-] Akmal akaga qo'ng'iroq 📅 2026-11-04 10:30 ^${akmal?.id}`)
    .split('\n').filter(l => !l.includes(`^${wrong?.id}`)).join('\n'));
  list = await tasks();
  ok("[-] — bekor qilindi va ro'yxatdan chiqdi; o'chirilgan qator vazifani o'chirmaydi, qaytib yoziladi", !list.some(t => t.id === akmal?.id) && !read().includes(`^${akmal?.id}`)
    && list.find(t => t.id === wrong?.id)?.status === 'open' && read().includes(`^${wrong?.id}`));
  ok("boshqa biznes bu vazifalarni ko'rmaydi", !((await api('/api/tasks', { token: otherToken })).json.tasks as Task[]).some(t => t.id === wrong?.id));

  // Telefondagi AI: yordamchi bilan bir xil bilim + ochiq vazifalar
  const ctx = String((await api('/api/brain/phone', { token })).json.context);
  ok("telefon uchun bilim: profil, faktlar va faqat ochiq vazifalar", ctx.includes('<business_profile>') && ctx.includes('<saved_notes>') && ctx.includes(`[${wrong?.id}]`) && !ctx.includes(`[${a.id}]`), ctx.slice(0, 300));

  // Telefon.md — har biznesga moslanadi: telefondagi AI shu sahifaga qarab gaplashadi
  const phoneFile = join(root, 'Telefon.md');
  const me = (await api('/api/me', { token })).json.business as { name: string; ownerName: string };
  let phone = (await api('/api/brain/phone', { token })).json as { business: string; owner: string; guide: string; voice: string | null };
  ok("Telefon.md yaratilgan va mundarijada; AI'ga: biznes nomi, egasi, ko'rsatma, standart ovoz (izohsiz)", phone.business === me.name && phone.owner === me.ownerName
    && phone.voice === 'standart' && phone.guide.includes('## Salomlashish') && phone.guide.includes(`Assalomu alaykum, ${me.ownerName}! Cerebro eshitadi.`) && !phone.guide.includes('{ism}') && !phone.guide.includes("AI'ga berilmaydi") && !/ovoz:/i.test(phone.guide)
    && readFileSync(join(root, 'INDEKS.md'), 'utf8').includes('[[Telefon|Telefon]]'), JSON.stringify(phone).slice(0, 300));
  writeFileSync(phoneFile, readFileSync(phoneFile, 'utf8').replace('ovoz: standart', 'ovoz: Aoede').replace('## Qanday gaplashsin', "## Qanday gaplashsin\n- Har qo'ng'iroq oxirida «Tabassum klinikasi xizmatingizda» de."));
  phone = (await api('/api/brain/phone', { token })).json;
  ok("Obsidian'da o'zgartirildi — keyingi qo'ng'iroqqa: yangi ovoz va qoida", phone.voice === 'Aoede' && phone.guide.includes('Tabassum klinikasi xizmatingizda'));
  const otherPhone = (await api('/api/brain/phone', { token: otherToken })).json as { guide: string; voice: string };
  ok("boshqa biznesning o'z Telefon.md si — bu o'zgartirish unga o'tmaydi", otherPhone.voice === 'standart' && !otherPhone.guide.includes('Tabassum klinikasi xizmatingizda'));
  rmSync(phoneFile);
  phone = (await api('/api/brain/phone', { token })).json;
  ok("Telefon.md o'chirildi — qayta yaratilmaydi, AI standart gaplashadi", !existsSync(phoneFile) && phone.guide === '' && phone.voice === null);

  // Qo'ng'iroq tugadi — Obsidian'ga sahifa
  const body = (startedAt: string) => ({ startedAt, seconds: 89, withWhom: "Ulug'bek (Telegram)", lines: [
    { at: '20:37:06', who: 'Cerebro', text: 'Assalomu alaykum, Ulug\'bek aka!' },
    { at: '20:37:10', who: 'Siz', text: 'Ertaga <script>x</script> universitetni eslat' },
    { at: '20:37:12', who: 'Amal', text: "Vazifa qo'shildi: Universitet — 2026-11-02 09:00" },
  ] });
  const call = await api('/api/brain/call', { token, body: body('2026-11-01T20:37:05') });
  const callText = call.status === 200 ? readFileSync(join(root, String(call.json.file)), 'utf8') : '';
  ok("qo'ng'iroq Obsidian'da: Qo'ng'iroqlar/ sahifa, «Nima qilindi» va suhbat; HTML zararsiz; mundarijada", call.json.file === "Qo'ng'iroqlar/2026-11-01 20-37.md"
    && callText.includes("## Nima qilindi\n- Vazifa qo'shildi: Universitet") && callText.includes('**Siz** (20:37:10): Ertaga') && !callText.includes('<script>')
    && readFileSync(join(root, 'INDEKS.md'), 'utf8').includes("## Qo'ng'iroqlar (1)"), callText.slice(0, 300));
  ok("bir xil daqiqadagi ikkinchi qo'ng'iroq ustidan yozmaydi", (await api('/api/brain/call', { token, body: body('2026-11-01T20:37:40') })).json.file === "Qo'ng'iroqlar/2026-11-01 20-37 (2).md");
  ok("noto'g'ri qo'ng'iroq yozuvi rad etiladi", (await api('/api/brain/call', { token, body: { startedAt: 'kecha', seconds: 1, withWhom: 'x', lines: [] } })).status === 400);
  const pages = ((await api('/api/brain', { token })).json.brain as { pages: { question: string }[] }).pages;
  ok("qo'ng'iroq va vazifalar bilim emas: mijozga javob beradigan sahifalar orasida yo'q", !pages.some(p => /Qo'ng'iroq|Vazifalar/.test(p.question)));
}
