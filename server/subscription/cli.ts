/**
 * Claude Code dasturi qayerda (obuna yo'li — Agent SDK). Yon ta'sirsiz: keys.ts (dastur boshida birinchi yuklanadi) ham ishlatadi —
 * login.ts esa yuklanishda bazadagi AI tanlovini o'qiydi, uni kalitlardan oldin yuklab bo'lmaydi
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Claude Code dasturi: CLAUDE_BIN (sinovda — soxta .mjs) yoki Agent SDK bilan kelgan claude.exe. Topilmasa — null */
export function claudeCommand(): { cmd: string; args: string[] } | null {
  const custom = process.env.CLAUDE_BIN?.trim();
  if (custom) return /\.m?js$/i.test(custom) ? { cmd: process.execPath, args: [custom] } : { cmd: custom, args: [] };
  try {
    const pkg = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const bin = join(dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
    return existsSync(bin) ? { cmd: bin, args: [] } : null;
  } catch {
    return null;
  }
}
