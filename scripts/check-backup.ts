/**
 * Zaxira tarkibi (server/backup.ts, H5): ilova .env ni o'qigan bo'lsa — u ham «sozlamalar.env» bo'lib nusxaga tushadi (tiklangan
 * kompyuterda kalitlarni qaytadan kiritish shart emas). DOTENV=0 holati — scripts/e2e-hub.ts da (nusxaga tushmaydi).
 * Ishga tushirish: npx tsx scripts/check-backup.ts
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Haqiqiy .env va data/ ga tegmaslik uchun: alohida ish papkasi, sinov .env bilan
const work = mkdtempSync(join(tmpdir(), 'palantir-zaxira-'));
const envText = 'SINOV_KALIT=zaxira-sinovi\n';
writeFileSync(join(work, '.env'), envText);
delete process.env.DOTENV;
process.env.DATA_DIR = join(work, 'data');
process.env.BACKUP_DIR = join(work, 'backups');
process.env.SESSION_SECRET = 'sinov-secret';
process.chdir(work);

let failed = 0;
try {
  const { backupNow } = await import('../server/backup');
  const dir = backupNow(new Date('2026-11-15T10:00:00'));
  assert.ok(dir, 'nusxa olinmadi');
  assert.ok(existsSync(join(dir, 'palantir.db')), 'baza');
  assert.equal(readFileSync(join(dir, 'sozlamalar.env'), 'utf8'), envText, 'sozlamalar.env');
  console.log("  ✓ H5: zaxirada baza va ilova sozlamalari (.env → sozlamalar.env)");
} catch (e) {
  failed++;
  console.log(`  ✗ H5: zaxira tarkibi\n    ${(e as Error).message}`);
}
try { rmSync(work, { recursive: true, force: true }); } catch { /* Windows: baza band */ }
console.log(failed ? `\n✗ ${failed} ta tekshiruv o'tmadi` : "\n✓ hammasi o'tdi");
process.exit(failed ? 1 : 0);
