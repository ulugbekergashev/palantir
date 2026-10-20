/** Ma'lumotlar diski: baza, qo'ng'iroq yozuvlari va zaxira shu yerda — to'lib qolsa baza yozolmaydi va zaxira olinmaydi */
import { statfsSync } from 'node:fs';

/** Papka turgan diskdagi bo'sh joy, MB (o'qib bo'lmasa — null) */
export function freeMb(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return Math.floor((s.bavail * s.bsize) / 1_048_576);
  } catch {
    return null;
  }
}

/** Joy chegaradan kam bo'lsa — egasiga tushunarli sabab, aks holda null */
export function diskProblem(dir: string, minFreeMb: number): string | null {
  const free = freeMb(dir);
  if (free == null || free >= minFreeMb) return null;
  return `bo'sh joy ${free} MB qoldi — keraksiz fayllarni o'chiring yoki zaxira papkasini boshqa diskka ko'chiring (BACKUP_DIR)`;
}
