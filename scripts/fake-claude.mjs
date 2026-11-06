/**
 * Soxta `claude` (Claude Code) — obunaga kirish sinovlari uchun (server/subscription/login.ts, CLAUDE_BIN=shu fayl).
 * Haqiqiy dasturning chiqishini takrorlaydi (claude.exe 2.1.316 dan olingan matnlar): havola terminal belgilari (OSC 8) bilan.
 * Holat FAKE_CLAUDE_STATE faylida: { loggedIn, plan, email, mode } — mode: code (kod kutadi), auto (brauzer o'zi tugatadi), fail.
 *   auth status --json   — kirilganmi
 *   auth login --claudeai — kirish: to'g'ri kod «goodcode#state1»
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.env.FAKE_CLAUDE_STATE;
const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { loggedIn: false, mode: 'code' }; } };
const save = s => writeFileSync(file, JSON.stringify(s));
const [cmd, sub] = process.argv.slice(2);
const state = read();

if (cmd === 'auth' && sub === 'status') {
  const out = state.loggedIn
    ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: state.email ?? 'klinika@example.uz', subscriptionType: state.plan ?? 'max' }
    : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(0);
}

if (cmd === 'auth' && sub === 'login') {
  const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=sinov&state=state1';
  process.stdout.write('Opening browser to sign in…\n');
  process.stdout.write(`If the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\n`);
  process.stdout.write('Paste code here if prompted > ');
  const ok = () => { save({ ...read(), loggedIn: true }); process.stdout.write('Login successful.\n'); process.exit(0); };
  if (state.mode === 'auto') setTimeout(ok, 300);
  else if (state.mode === 'fail') setTimeout(() => { process.stderr.write('Login failed: Request failed with status code 403\n'); process.exit(1); }, 300);
  else {
    createInterface({ input: process.stdin }).on('line', line => {
      if (line.trim() === 'goodcode#state1') ok();
      else { process.stderr.write('Login failed: Invalid authorization code\n'); process.exit(1); }
    });
  }
} else {
  process.stderr.write(`soxta claude: ${process.argv.slice(2).join(' ')} — bilmayman\n`);
  process.exit(2);
}
