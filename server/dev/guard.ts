/**
 * Dasturchi cheklovlari (sof qoidalar): qaysi buyruq va fayl yopiq. Bu — xatodan himoya, qamoq emas: ish egasining kompyuterida,
 * egasining topshirig'i bilan boradi. Yopiq narsalar — qaytarib bo'lmaydigan yoki tashqariga chiqadigan amallar:
 *   tashqariga yuborish (push, deploy, publish, ssh) — mijozlarga ketadigan narsani faqat egasi chiqaradi;
 *   kutubxonalar (npm install/ci, node_modules o'chirish) — ish nusxasidagi node_modules asl loyihanikiga ulangan (git.ts): unga yozish
 *   yoki o'chirish egasining ishlab turgan loyihasini buzadi;
 *   git'ning umumiy qismi (stash, boshqa shoxlar, sozlama) — ish nusxasi va asl loyihada bitta;
 *   boshqa jarayonlar (taskkill /im node.exe — Palantir'ning o'zini ham o'ldiradi) va tizim sozlamalari;
 *   maxfiy fayllar (.env, kalitlar, baza).
 * Qoida buyruqning BOSHIGA qaraydi (har bo'lak alohida): `grep shutdown src` yoki `git commit -m "npm install haqida"` yopilmaydi.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** git/npm'ning o'z kalitlari (qiymati bilan): `git -C papka push`, `npm --prefix x install` */
const FLAGS = String.raw`(?:\s+-\S+(?:\s+[^-\s]\S*)?)*?`;
const PM = String.raw`^(?:npm|pnpm|yarn|bun)${FLAGS}`;
const rule = (source: string, why: string): [RegExp, string] => [new RegExp(source), why];

const PUSH = "tashqariga yuborish (push) — egasi o'zi qiladi";
const DEPLOY = "deploy/release — mijozlarga chiqarishni egasi o'zi qiladi";
const MODULES = "kutubxona o'rnatish yoki o'chirish — yopiq (node_modules asl loyihaniki). Kerak bo'lsa hisobotda ayting";
const RULES: [RegExp, string][] = [
  rule(String.raw`^git${FLAGS}\s+push(?=\s|$)`, PUSH),
  rule(String.raw`^git${FLAGS}\s+(?:remote\s+(?:add|set-url|remove|rm|rename)|worktree|stash|update-ref|gc|prune|filter-branch|filter-repo|reflog\s+(?:expire|delete)|tag\s+(?:-d|--delete)|branch\s+(?:\S+\s+)*?(?:-d|-m|-c|--delete|--move|--copy)|config(?!\s+(?:--get|--list|-l)(?=\s|$)))(?=\s|$)`,
    "git'ning umumiy qismi (stash, boshqa shoxlar, sozlama, ish nusxalari) — yopiq: u asl loyiha bilan bitta"),
  rule(String.raw`${PM}\s+(?:i|install|add|remove|rm|uninstall|un|ci|update|upgrade|up|prune|dedupe|link|rebuild|import|audit\s+fix)(?=\s|$)`, MODULES),
  rule(String.raw`^yarn(?:\s+-\S+)*$`, MODULES),
  rule(String.raw`${PM}\s+(?:publish|deploy)(?=\s|$)`, DEPLOY),
  rule(String.raw`^(?:vercel|netlify|firebase|railway|flyctl|fly|heroku|wrangler|eas|surge)(?=\s|$)`, DEPLOY),
  rule(String.raw`^gh\s+(?:release|secret|api|workflow\s+run|pr\s+(?:create|merge|close|edit|ready)|repo\s+(?:create|delete|edit|rename|sync))(?=\s|$)`, DEPLOY),
  rule(String.raw`^(?:ssh|scp|sftp|rsync|ftp|telnet)(?=\s|$)`, 'boshqa kompyuterga ulanish — yopiq'),
  rule(String.raw`^docker\s+(?:push|login)(?=\s|$)`, 'docker push — yopiq'),
  rule(String.raw`^(?:shutdown|restart-computer|stop-computer|schtasks|bcdedit|diskpart|format|setx|set-executionpolicy|reg\s+(?:add|delete|import)|sc(?:\.exe)?\s+(?:stop|delete|config|create)|net\s+(?:user|stop|start|localgroup))(?=\s|$)`, 'tizim sozlamalari — yopiq'),
];

/** Buyruq oldidagi o'ramlar: o'zgaruvchi (A=1), sudo, npx, `bash -c "…"` — qoida ular ortidagi buyruqqa qaraydi */
const WRAPPER = /^(?:(?:[a-z_]\w*=\S*|sudo|time|env|npx|pnpx|bunx|exec|command|call|start|&|(?:bash|sh|cmd|powershell|pwsh)(?:\.exe)?(?:\s+[-/]\S+)*)\s+)+["']?/i;
/** Bitta qatordagi buyruqlar: &&, ||, ;, |, yangi qator, $( … ), ` … ` */
const segmentsOf = (command: string): string[] =>
  command.split(/&&|\|\||[;|\n`]|\$\(/).map(s => s.trim().replace(/^[({\s]+/, '').replace(WRAPPER, '').replace(/["')]+$/, '').replace(/\s+/g, ' ')).filter(Boolean);

/** npm skripti nomi bo'yicha: deploy, release, publish, upload (hub:deploy, release:win) — yopiq; test:release-notes — ochiq */
const SCRIPT = new RegExp(String.raw`${PM}\s+(?:run(?:-script)?\s+)?([^\s-]\S*)`);
const SAFE_SCRIPT = /^(?:test|lint|check|typecheck|build)(?:[:\-_]|$)/;
const OUT_SCRIPT = /(?:^|[:\-_])(?:deploy|publish|release|reliz|upload)(?:[:\-_]|$)/;
function outScript(seg: string): boolean {
  const name = SCRIPT.exec(seg)?.[1] ?? '';
  return !!name && !/[\\/.]/.test(name) && !SAFE_SCRIPT.test(name) && OUT_SCRIPT.test(name);
}

const DELETE_VERB = /(?:^|\s)(?:rm|rmdir|rd|del|erase|rimraf|remove-item|ri|unlink)(?=\s|$)|-delete\b|rmsync|rmtree/;
/** Butun papkani yoki ish nusxasidan tashqarini o'chirish: `rm -rf *`, `rm -rf ..`, `rm -rf /x`, `rd /s .` */
function wideDelete(seg: string): boolean {
  if (!/^(?:rm|rmdir|rd|del|remove-item|ri)\s/.test(seg) || !/\s(?:-[a-z]*r[a-z]*|--recursive|-recurse|\/s)(?=\s|$)/.test(seg)) return false;
  const targets = seg.split(' ').slice(1).filter(t => !t.startsWith('-') && !/^\/[a-z]$/.test(t)).map(t => t.replace(/^["']|["']$/g, ''));
  return targets.some(t => /^(?:\.|\.[\\/]|\*|\.[\\/]\*|\.\..*|~.*|[\\/].*|[a-z]:.*|\$.*|%.*)$/.test(t));
}

/** Nomi bo'yicha jarayon o'ldirish (PID bilan — ochiq: o'zi ochgan jarayonni yopadi) */
const killByName = (seg: string): boolean => /^(?:taskkill|stop-process|pkill|killall)(?=\s|$)/.test(seg) && !/\s(?:\/pid|-id)\s/.test(seg);

const LOCAL_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/i;
/** Tashqi manzilga ma'lumot yuborish (asl harflar bilan: curl'da -F — forma, -f — «xatoda jim») */
function upload(raw: string): boolean {
  const curl = /^(?:curl|wget)(?=\s|$)/i.test(raw) && /\s(?:-d|--data\S*|-F|--form\S*|-T|--upload-file|--post-data\S*|--post-file\S*|--method\S*|(?:-X|--request)[\s=]*(?:POST|PUT|PATCH|DELETE))(?=[\s=]|$)/.test(raw);
  const ps = /^(?:invoke-webrequest|iwr|invoke-restmethod|irm)(?=\s|$)/i.test(raw) && /\s-(?:method\s+(?:post|put|patch|delete)|body|infile)(?=\s|$)/i.test(raw);
  if (!curl && !ps) return false;
  const urls = raw.match(/https?:\/\/[^\s"']+/gi) ?? [];
  return urls.length === 0 || urls.some(u => !LOCAL_URL.test(u));
}

/** .env, .env.local, .env.production… (.env.example — ochiq: unda sir yo'q) */
const ENV_FILE = /(^|[\s/\\"'=<>(])\.env(\.(?!example\b|sample\b|template\b)[\w-]+)*(?=$|[\s"'|;&)<>*])/;
/** Kalit va baza fayllari. `.key` — faqat yo'l ichida (certs/server.key): `grep "e.key" src` yopilmasin. cerebro.db — eski nom bazasi */
const SECRET_FILE = /([\w-]+\.(pem|pfx|p12|keystore|jks)|[\\/][\w.-]+\.key|id_(rsa|ed25519|ecdsa)|session\.secret|(palantir|cerebro)\.db|\.npmrc|credentials\.json)(?=$|[\s"'|;&)<>*])/;

/** Buyruq yopiqmi: yopiq bo'lsa — sababi (modelga qaytadi), aks holda null */
export function bashDenied(command: string): string | null {
  for (const raw of segmentsOf(command)) {
    const seg = raw.toLowerCase();
    const hit = RULES.find(([re]) => re.test(seg));
    if (hit) return hit[1];
    if (outScript(seg)) return DEPLOY;
    if (seg.includes('node_modules') && DELETE_VERB.test(seg)) return "node_modules o'chirilmaydi (asl loyihaniki)";
    if (wideDelete(seg)) return "butun papkani yoki ish nusxasidan tashqarini o'chirish — yopiq. Aniq fayl yoki ichki papkani nisbiy yo'l bilan o'chiring";
    if (killByName(seg)) return "jarayonlarni nomi bo'yicha o'ldirish — yopiq (faqat o'zingiz ochgan jarayonni PID bilan)";
    if (upload(raw)) return "tashqi manzilga ma'lumot yuborish — yopiq";
  }
  const c = command.toLowerCase();
  if (ENV_FILE.test(c) || SECRET_FILE.test(c)) return 'maxfiy fayllar (.env, kalitlar, baza) — yopiq. Kerakli sozlama nomini .env.example dan oling';
  return null;
}

export const secretPath = (path: string): boolean => {
  const p = path.toLowerCase();
  return ENV_FILE.test(p) || SECRET_FILE.test(p);
};

/** path shu papka ichidami (o'zi ham); `..` va boshqa disk — yo'q */
export function inside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Yoziladigan fayl: faqat ish nusxasi ichida, node_modules (asl loyihaga ulangan) va .git dan tashqari, maxfiy fayl emas */
export function writeDenied(workDir: string, path: string): string | null {
  if (!path) return "fayl yo'li yo'q";
  if (!inside(workDir, path)) return "faqat shu loyihaning ish nusxasi ichida yozing (boshqa papka — yopiq)";
  // Windows'da papka nomi harf kattaligiga qaramaydi: Node_Modules — o'sha papka
  const parts = relative(resolve(workDir), resolve(workDir, path)).toLowerCase().split(sep);
  if (parts.includes('node_modules') || parts[0] === '.git') return 'node_modules va .git ichiga yozilmaydi';
  if (secretPath(path)) return 'maxfiy fayllar (.env, kalitlar) — yopiq';
  return null;
}

export type ToolCall = { tool: string; input: Record<string, unknown> };
const SECRET = 'maxfiy fayllar (.env, kalitlar, baza) — yopiq';

/** Bitta asbob chaqiruvi yopiqmi (Agent SDK PreToolUse): sababi yoki null */
export function toolDenied(workDir: string, { tool, input }: ToolCall): string | null {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  if (tool === 'Bash' || tool === 'PowerShell') return bashDenied(str('command'));
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return writeDenied(workDir, str('file_path'));
  if (tool === 'NotebookEdit') return writeDenied(workDir, str('notebook_path'));
  if (tool === 'Read') return secretPath(str('file_path')) ? SECRET : null;
  // Qidiruv: maxfiy faylning o'zi nishon bo'lmasin (Grep'da pattern — qidirilayotgan matn, fayl emas)
  if (tool === 'Glob') return [str('path'), str('pattern')].some(secretPath) ? SECRET : null;
  if (tool === 'Grep') return [str('path'), str('glob')].some(secretPath) ? SECRET : null;
  return `${tool} — bu ishda yo'q`;
}

/**
 * Dasturchining muhiti: Palantir'ning o'z sozlamalari va sirlari (bot tokeni, baza papkasi, port, Hub kalitlari) unga o'tmaydi —
 * aks holda ish nusxasida `npm run dev` jonli baza va jonli bot bilan ishga tushardi (loyiha Palantir'ning o'zi bo'lsa).
 * own — Palantir .env faylidagi nomlar; qolganlari — nomi bo'yicha. Obuna tokeni (CLAUDE_*) qoladi
 */
const OURS = /^(DATA_DIR|PORT|BOT_TOKEN|SESSION_SECRET|BACKUP_DIR|DOTENV|TZ_FORCE)$|^(HUB_|ADMIN_|DEV_|AI_|COMPUTER_|LICENSE_|RELEASE_|UPDATE_|GEMINI|TELEGRAM|TG_|VOICE|ZADARMA|SIP_|META_|INSTAGRAM|IG_|WEBHOOK|REMOTE_|OFFSITE|VIDEO_)/i;
export function agentEnv(src: Record<string, string | undefined>, own: string[]): Record<string, string | undefined> {
  const drop = new Set(own.map(k => k.toUpperCase()));
  return Object.fromEntries(Object.entries(src).filter(([k]) => /^CLAUDE_/i.test(k) || (!drop.has(k.toUpperCase()) && !OURS.test(k))));
}
