/**
 * O'rnatgich fayllari (install/): klinika kompyuterida PowerShell 5.1 va wscript faylni ANSI deb o'qiydi — «, », — va boshqa
 * belgilar buzilib, skript sintaksisi yiqiladi. Shu sinov: hamma .ps1/.vbs/.cmd faqat ASCII, .ps1 lar PowerShell'da xatosiz o'qiladi.
 *   npm run test:install   (PowerShell qismi faqat Windows'da)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve('install');
let failed = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};

console.log("\n# O'rnatgich fayllari");
const files = readdirSync(DIR).filter(f => /\.(ps1|vbs|cmd)$/i.test(f));
for (const f of files) {
  const lines = readFileSync(join(DIR, f), 'utf8').split('\n');
  const bad = lines.findIndex(l => /[^\x00-\x7f]/.test(l));
  ok(`${f}: faqat ASCII`, bad < 0, bad < 0 ? '' : `${bad + 1}-qator: ${lines[bad].trim().slice(0, 80)}`);
}

if (process.platform === 'win32') {
  const ps1 = files.filter(f => f.toLowerCase().endsWith('.ps1')).map(f => join(DIR, f));
  // Har fayl PowerShell'ning o'z tahlilchisida (faqat o'qiladi, ISHGA TUSHIRILMAYDI): sintaksis xatolari «fayl: qator: xabar».
  // Ro'yxat muhit o'zgaruvchisida: -Command dan keyingi argumentlar buyruqqa qo'shilib, fayllar bajarilib ketardi
  const script = `foreach ($f in ($env:PALANTIR_PS1 -split '\\|')) { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$null, [ref]$e); foreach ($x in $e) { "$(Split-Path -Leaf $f): $($x.Extent.StartLineNumber): $($x.Message)" } }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, PALANTIR_PS1: ps1.join('|') } });
  const errors = String(r.stdout ?? '').trim();
  ok(`PowerShell: ${ps1.length} ta .ps1 xatosiz o'qiladi`, r.status === 0 && !errors, errors || String(r.stderr ?? '').trim().slice(0, 300));
}

console.log(failed ? `\n${failed} ta xato` : `\nhammasi o'tdi`);
process.exit(failed ? 1 : 0);
